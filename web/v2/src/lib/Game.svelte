<script>
  // GAME pane — V2's playable companion to CART. CART shows the Rust-
  // decoded header; GAME runs the cartridge via the vendored gbajs2
  // classic scripts loaded in index.html. The bridge there publishes
  // GameBoyAdvance and biosBin onto window so this module can reach
  // them.
  //
  // Loading is opt-in. gbajs2's setRom does a sync save-type scan over
  // the whole cart, which blocks the main thread for a second-plus on
  // a 16 MiB Pokemon ROM. We don't pay that cost just because the user
  // opened the tab — we wait for an explicit PLAY click, paint a
  // "loading…" frame, then let it block. Audio + video then come up
  // together.

  import { onDestroy } from 'svelte';
  import MiniHex from './MiniHex.svelte';
  import { describeGbaAddress, currentGbaMode, currentGbaPc } from './gba.js';

  let { bytes, header, onPcUpdate = null } = $props();

  let canvas;
  let gba = null;
  let romLoaded = $state(false);
  let running = $state(false);
  let status = $state('cart ready \u00B7 click PLAY');
  let cursor = $state(null);
  let livePc = $state(null);
  let pcMode = $state('ARM');
  let inCart = $state(false);
  let follow = $state(true);
  let pcTrail = $state([]);
  let clickNote = $state('');
  let pcRaf = 0;
  let pcLastTick = 0;

  const CANVAS_W = 480;
  const CANVAS_H = 320;
  const PC_THROTTLE_MS = 100; // ~10 Hz
  const PC_TRAIL_MAX = 8;

  function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
  }

  function hex8(n) {
    return '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }

  function publishPc() {
    onPcUpdate?.({
      follow,
      running,
      liveAddress: livePc?.address ?? null,
      label: livePc?.label ?? (romLoaded ? 'READY' : 'IDLE'),
      mode: pcMode,
      inCart,
      offset: cursor,
      mirrored: !!livePc?.mirrored,
      trail: pcTrail,
      ts: performance.now(),
    });
  }

  function pushTrail(pcInfo) {
    if (!pcInfo?.inCart || pcInfo.offset == null) return;
    const last = pcTrail[0];
    if (last && Math.floor(last.offset / 16) === Math.floor(pcInfo.offset / 16)) return;
    pcTrail = [{
      address: pcInfo.address,
      offset: pcInfo.offset,
      label: pcInfo.label,
      mode: pcMode,
      mirrored: pcInfo.mirrored,
      ts: performance.now(),
    }, ...pcTrail].slice(0, PC_TRAIL_MAX);
  }

  function onMiniHexByte(off) {
    if (running) {
      clickNote = `ROM ${hex8(off)} selected while running`;
      return;
    }
    clickNote = `ROM ${hex8(off)} \u00B7 bus ${hex8(0x08000000 + off)} \u00B7 V2 DISASM is not shipped yet`;
  }

  function ensureGba() {
    if (gba) return gba;
    if (typeof window.GameBoyAdvance !== 'function') {
      throw new Error('gbajs not loaded');
    }
    if (!window.biosBin) {
      throw new Error('biosBin not loaded');
    }
    gba = new window.GameBoyAdvance();
    // Force the software renderer. proxy.js loads its worker via the relative
    // URL 'js/video/worker.js', which under our Pages deployment 404s. The
    // failure fires async, so video.js's sync try/catch never falls back and
    // we end up with a renderer that emits no frames (audio works, canvas
    // stays black). Tear down the proxy's worker and swap in software.
    if (typeof window.GameBoyAdvanceSoftwareRenderer === 'function') {
      try { gba.video.renderPath?.worker?.terminate?.(); } catch (_) {}
      gba.video.renderPath = new window.GameBoyAdvanceSoftwareRenderer();
    }
    gba.keypad.eatInput = true;
    gba.logLevel = gba.LOG_ERROR;
    gba.setLogger((level, msg) => console.warn('[scry/v2/game/gba]', msg));
    gba.setCanvas(canvas);
    gba.setBios(window.biosBin);
    return gba;
  }

  async function play() {
    if (!bytes) return;
    if (running) return;
    canvas.focus();
    if (!romLoaded) {
      status = 'loading ROM\u2026';
      // Two rAFs: first paints "loading", second guarantees the paint
      // committed before we start blocking on setRom.
      await new Promise(r => requestAnimationFrame(r));
      await new Promise(r => requestAnimationFrame(r));
      try {
        const inst = ensureGba();
        const rom = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const ok = inst.setRom(rom);
        if (!ok) {
          status = 'rom rejected';
          return;
        }
        romLoaded = true;
        inst.runStable();
        running = true;
        status = 'running';
        publishPc();
        startPcPoll();
      } catch (e) {
        console.error('[scry/v2/game] load failed', e);
        status = 'error: ' + (e?.message || e);
      }
      return;
    }
    gba.runStable();
    running = true;
    status = 'running';
    publishPc();
    startPcPoll();
  }

  function pause() {
    if (!gba || !gba.hasRom()) return;
    gba.pause();
    running = false;
    status = 'paused';
    stopPcPoll();
    publishPc();
  }

  // PC tracker. We read gba.cpu.gprs[15] (ARM PC register, gbajs2 core.js)
  // and, if it falls inside the cart region [0x08000000, base+romSize),
  // convert to a file offset. Many GBA games copy hot loops into IWRAM
  // (0x03007000-ish) and spend most cycles there, so on any given tick
  // PC is just as likely to be outside the cart as inside. Nulling the
  // cursor in those frames would make the highlight flicker out and
  // FOLLOW look broken. Instead we keep the last in-cart offset
  // (`cursor`) and surface the live status separately (`inCart`).
  function pollPc(ts) {
    pcRaf = requestAnimationFrame(pollPc);
    if (!running || !gba || !bytes) return;
    if (ts - pcLastTick < PC_THROTTLE_MS) return;
    pcLastTick = ts;
    const pc = currentGbaPc(gba.cpu);
    if (pc === null) return;
    pcMode = currentGbaMode(gba.cpu);
    livePc = describeGbaAddress(pc, bytes.byteLength);
    if (livePc.inCart && livePc.offset !== null) {
      cursor = livePc.offset;
      inCart = true;
      pushTrail(livePc);
    } else {
      inCart = false;
    }
    publishPc();
  }
  function startPcPoll() {
    if (pcRaf) return;
    pcLastTick = 0;
    pcRaf = requestAnimationFrame(pollPc);
  }
  function stopPcPoll() {
    if (pcRaf) cancelAnimationFrame(pcRaf);
    pcRaf = 0;
  }

  function toggleFollow() {
    follow = !follow;
    publishPc();
  }

  function reset() {
    if (!gba || !bytes) return;
    const wasRunning = running;
    if (wasRunning) {
      try { gba.pause(); } catch { /* ignore */ }
      running = false;
    }
    stopPcPoll();
    cursor = null;
    livePc = null;
    inCart = false;
    romLoaded = false;
    status = 'cart ready \u00B7 click PLAY';
    publishPc();
    if (wasRunning) play();
  }

  // If the file goes away (user closes the cart), reset our state.
  $effect(() => {
    const b = bytes;
    if (!b) {
      if (gba && running) {
        try { gba.pause(); } catch { /* ignore */ }
      }
      stopPcPoll();
      cursor = null;
      livePc = null;
      inCart = false;
      follow = true;
      pcTrail = [];
      clickNote = '';
      romLoaded = false;
      running = false;
      status = 'idle';
      publishPc();
    } else {
      // Fresh cart bytes (could be the same buffer or a new one). If we
      // had a previous ROM loaded, force a reload on next PLAY.
      if (!running) status = 'cart ready \u00B7 click PLAY';
      if (!romLoaded) {
        cursor = null;
        livePc = null;
        inCart = false;
        pcTrail = [];
        clickNote = '';
        publishPc();
      }
    }
  });

  onDestroy(() => {
    if (gba && running) {
      try { gba.pause(); } catch { /* ignore */ }
    }
    stopPcPoll();
  });
</script>

<div class="g-wrap">
  <div class="g-bar">
    <span class="g-title">[ GBA / EMULATOR ]</span>
    {#if header}
      <span class="g-meta">"{header.title || '(blank)'}" &middot; {header.game_code} &middot; {fmtBytes(header.rom_size)}</span>
    {/if}
  </div>

  <div class="g-split">
    <div class="g-left">
      <div class="g-canvas-wrap">
        <canvas
          bind:this={canvas}
          width={CANVAS_W}
          height={CANVAS_H}
          tabindex="0"
          class="g-canvas"
        ></canvas>
      </div>
      <div class="g-controls">
        <button class="g-btn" type="button" onclick={play} disabled={!bytes || running}>PLAY</button>
        <button class="g-btn" type="button" onclick={pause} disabled={!running}>PAUSE</button>
        <button class="g-btn" type="button" onclick={reset} disabled={!bytes || !romLoaded}>RESET</button>
        <button
          class="g-follow"
          class:g-follow-on={follow}
          type="button"
          onclick={toggleFollow}
          disabled={!romLoaded}
          title="Auto-scroll the ROM view to wherever the CPU's program counter currently is"
        >
          <span class="g-follow-led" aria-hidden="true"></span>
          <span class="g-follow-lab">{follow ? 'FOLLOWING PC' : 'FOLLOW PC'}</span>
        </button>
        <span class="g-status">{status}</span>
        <span class="g-hint">arrows = D-pad &middot; Z/X = A/B &middot; Enter = Start</span>
      </div>
    </div>

    <div class="g-right">
      <div class="g-sub-bar">
        <span class="g-sub-title">[ ROM / INSPECTOR ]</span>
        <span class="g-sub-hint">
          {#if running && cursor !== null}
            <span class:g-pc-dim={!livePc?.inCart}>
              {pcMode} PC&rarr;{hex8(livePc?.address ?? 0)}
              &middot; {livePc?.label ?? 'BUS'}
              {#if livePc?.inCart && livePc?.offset !== null}
                &middot; ROM {hex8(livePc.offset)}
                {#if livePc.mirrored}&middot; mirror{/if}
              {/if}
            </span>
          {:else if livePc}
            <span class:g-pc-dim={!livePc.inCart}>
              {pcMode} PC&rarr;{hex8(livePc.address)} &middot; {livePc.label}
              {#if livePc.inCart && livePc.offset !== null}&middot; ROM {hex8(livePc.offset)}{/if}
            </span>
          {:else if running}
            waiting for first PC sample&hellip;
          {:else}
            pause &middot; scroll &middot; jump 0x...
          {/if}
        </span>
      </div>
      <MiniHex {bytes} {cursor} {follow} onByteClick={onMiniHexByte} />
      <div class="g-pc-trail">
        {#if pcTrail.length}
          <div class="g-trail-title">RECENT CART PC</div>
          {#each pcTrail as p, i}
            <button class="g-trail-row" class:hot={i === 0} type="button" onclick={() => (cursor = p.offset)}>
              <span class="g-trail-age">{i === 0 ? 'NOW' : `-${i}`}</span>
              <span class="g-trail-pc">{hex8(p.address)}</span>
              <span class="g-trail-off">{hex8(p.offset)}</span>
              <span class="g-trail-mode">{p.mode}</span>
            </button>
          {/each}
        {:else}
          PC trail: waiting for cart code
        {/if}
        {#if clickNote}<div class="g-click-note">{clickNote}</div>{/if}
      </div>
    </div>
  </div>
</div>

<style>
  .g-wrap {
    display: flex; flex-direction: column;
    height: 100%; padding: 0 22px 22px;
    min-height: 0;
  }
  .g-bar {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 18px; padding: 16px 0 12px;
    border-bottom: 1px solid var(--grey);
  }
  .g-title { font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
  .g-meta  { font-size: 10px; color: var(--mint-deep); letter-spacing: 0.08em; }

  .g-split {
    flex: 1; min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 18px;
    padding: 14px 0 0;
  }
  .g-left {
    display: flex; flex-direction: column;
    min-height: 0; min-width: 0;
  }
  .g-right {
    display: flex; flex-direction: column;
    min-height: 0; min-width: 0;
    gap: 8px;
  }
  .g-sub-bar {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 12px;
    font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
  }
  .g-sub-title { color: var(--muted); }
  .g-sub-hint  { color: var(--muted); font-size: 9px; }

  .g-canvas-wrap {
    flex: 1; min-height: 0;
    display: flex; align-items: center; justify-content: center;
    padding: 0 0 12px;
  }
  /* Explicit display dimensions with shrink-to-fit. Without these, the
     canvas's height:auto sometimes collapses inside a flex column whose
     parent height is short, leaving the backing pixels invisible
     (audio still plays — that's the giveaway). Matches v1's canvas. */
  .g-canvas {
    width: 480px;
    height: 320px;
    max-width: 100%;
    max-height: 100%;
    background: #000;
    image-rendering: pixelated;
    image-rendering: -moz-crisp-edges;
    image-rendering: crisp-edges;
    outline: 1px solid var(--rule);
    border: 0;
    display: block;
  }
  .g-canvas:focus { outline: 2px solid var(--mint-deep); }

  .g-controls {
    display: flex; align-items: center; gap: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--grey);
    flex-wrap: wrap;
  }
  .g-btn {
    font-family: inherit;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--mint-deep);
    background: transparent;
    border: 1px solid var(--mint-deep);
    padding: 6px 14px;
    cursor: pointer;
    transition: color 120ms ease, background 120ms ease;
  }
  .g-btn:hover:not(:disabled) { color: var(--paper); background: var(--mint-deep); }
  .g-btn:disabled { color: var(--rule); border-color: var(--rule); cursor: not-allowed; }
  /* FOLLOW PC toggle. Visually distinct from the transport buttons (play/
     pause/reset) so its state is unmistakable: a small LED-style dot fills
     in when the auto-scroll is engaged, and the label changes from "FOLLOW
     PC" (passive) to "FOLLOWING PC" (active). When the cart isn't loaded
     yet the whole thing greys out so it's clearly inert. */
  .g-follow {
    display: inline-flex; align-items: center; gap: 8px;
    font-family: inherit;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
    background: transparent;
    border: 1px dashed var(--rule);
    padding: 6px 12px;
    cursor: pointer;
    transition: color 120ms ease, background 120ms ease,
                border-color 120ms ease;
  }
  .g-follow:hover:not(:disabled) { color: var(--mint-deep); border-color: var(--mint-deep); }
  .g-follow:disabled { color: var(--rule); border-color: var(--rule); cursor: not-allowed; }
  .g-follow-led {
    width: 8px; height: 8px;
    border-radius: 50%;
    border: 1px solid currentColor;
    background: transparent;
    display: inline-block;
    transition: background 120ms ease, box-shadow 120ms ease;
  }
  .g-follow-on {
    color: var(--paper);
    background: var(--mint-deep);
    border-style: solid;
    border-color: var(--mint-deep);
  }
  .g-follow-on .g-follow-led {
    background: var(--paper);
    box-shadow: 0 0 6px var(--paper);
  }

  .g-pc-dim { color: var(--muted); }
  .g-pc-trail {
    display: grid;
    grid-template-columns: 1fr;
    gap: 3px;
    max-height: 132px;
    overflow: auto;
    border: 1px solid var(--rule);
    background: var(--paper);
    padding: 7px 9px;
    font-size: 10px;
  }
  .g-trail-title {
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 2px;
  }
  .g-trail-row {
    display: grid;
    grid-template-columns: 34px 1fr 1fr 48px;
    gap: 8px;
    align-items: center;
    border: 0;
    border-left: 2px solid transparent;
    background: transparent;
    color: var(--ink);
    font-family: inherit;
    font-size: 10px;
    line-height: 1.5;
    text-align: left;
    padding: 1px 0 1px 6px;
    cursor: pointer;
  }
  .g-trail-row:hover { background: var(--tint-row); border-left-color: var(--mint-deep); }
  .g-trail-row.hot { background: var(--mint-pale); }
  .g-trail-age, .g-trail-mode { color: var(--muted); font-size: 9px; letter-spacing: 0.08em; }
  .g-trail-off { color: var(--mint-deep); }
  .g-click-note {
    border-top: 1px solid var(--rule);
    margin-top: 4px;
    padding-top: 5px;
    color: var(--muted);
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .g-status {
    font-size: 10px; letter-spacing: 0.12em; color: var(--muted);
    margin-left: 4px;
  }
  .g-hint {
    margin-left: auto;
    font-size: 9px; letter-spacing: 0.12em; color: var(--muted); text-transform: uppercase;
  }

  @media (max-width: 960px) {
    .g-split {
      grid-template-columns: 1fr;
      grid-auto-rows: minmax(0, auto);
    }
  }
  @media (max-width: 760px) {
    .g-wrap { padding: 0 14px 14px; }
    .g-hint { display: none; }
  }
</style>
