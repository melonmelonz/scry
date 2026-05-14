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

  let { bytes, header } = $props();

  let canvas;
  let gba = null;
  let romLoaded = false;
  let running = $state(false);
  let status = $state('cart ready \u00B7 click PLAY');

  const CANVAS_W = 480;
  const CANVAS_H = 320;

  function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
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
      } catch (e) {
        console.error('[scry/v2/game] load failed', e);
        status = 'error: ' + (e?.message || e);
      }
      return;
    }
    gba.runStable();
    running = true;
    status = 'running';
  }

  function pause() {
    if (!gba || !gba.hasRom()) return;
    gba.pause();
    running = false;
    status = 'paused';
  }

  function reset() {
    if (!gba || !bytes) return;
    const wasRunning = running;
    if (wasRunning) {
      try { gba.pause(); } catch { /* ignore */ }
      running = false;
    }
    romLoaded = false;
    status = 'cart ready \u00B7 click PLAY';
    if (wasRunning) play();
  }

  // If the file goes away (user closes the cart), reset our state.
  $effect(() => {
    const b = bytes;
    if (!b) {
      if (gba && running) {
        try { gba.pause(); } catch { /* ignore */ }
      }
      romLoaded = false;
      running = false;
      status = 'idle';
    } else {
      // Fresh cart bytes (could be the same buffer or a new one). If we
      // had a previous ROM loaded, force a reload on next PLAY.
      if (!running) status = 'cart ready \u00B7 click PLAY';
    }
  });

  onDestroy(() => {
    if (gba && running) {
      try { gba.pause(); } catch { /* ignore */ }
    }
  });
</script>

<div class="g-wrap">
  <div class="g-bar">
    <span class="g-title">[ GBA / EMULATOR ]</span>
    {#if header}
      <span class="g-meta">"{header.title || '(blank)'}" &middot; {header.game_code} &middot; {fmtBytes(header.rom_size)}</span>
    {/if}
  </div>

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
    <span class="g-status">{status}</span>
    <span class="g-hint">arrows = D-pad &middot; Z/X = A/B &middot; Enter = Start</span>
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

  .g-canvas-wrap {
    flex: 1; min-height: 0;
    display: flex; align-items: center; justify-content: center;
    padding: 18px 0;
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

  .g-status {
    font-size: 10px; letter-spacing: 0.12em; color: var(--muted);
    margin-left: 4px;
  }
  .g-hint {
    margin-left: auto;
    font-size: 9px; letter-spacing: 0.12em; color: var(--muted); text-transform: uppercase;
  }

  @media (max-width: 760px) {
    .g-wrap { padding: 0 14px 14px; }
    .g-hint { display: none; }
  }
</style>
