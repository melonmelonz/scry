<script>
  // GAME pane — V2's playable companion to CART. CART shows the Rust-
  // decoded header; GAME runs the cartridge via the vendored gbajs2
  // classic scripts loaded in index.html. The bridge there publishes
  // GameBoyAdvance and biosBin onto window so this module can reach
  // them.

  let { bytes, header } = $props();

  let canvas;
  let gba = null;
  let running = $state(false);
  let status = $state('idle');
  let booted = $state(false);

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

  // Yield to the rendering thread between heavy phases so the status
  // text actually paints. setRom does a save-type scan over the whole
  // cart which can take a moment on 16 MiB ROMs.
  async function loadCart(b) {
    status = 'booting\u2026';
    await new Promise(r => requestAnimationFrame(r));
    try {
      const inst = ensureGba();
      status = 'copying ROM\u2026';
      await new Promise(r => requestAnimationFrame(r));
      const rom = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      status = 'parsing cart\u2026';
      await new Promise(r => requestAnimationFrame(r));
      const ok = inst.setRom(rom);
      if (!ok) {
        status = 'rom rejected';
        return;
      }
      status = 'paused \u00B7 click PLAY';
      running = false;
      booted = true;
    } catch (e) {
      console.error('[scry/v2/game] load failed', e);
      status = 'error: ' + (e?.message || e);
    }
  }

  function play() {
    if (!gba || !gba.hasRom()) return;
    if (running) return;
    canvas.focus();
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
    pause();
    loadCart(bytes).then(() => { if (wasRunning) play(); });
  }

  // Boot the cart once the canvas element is wired up. We defer with a
  // rAF so the element has real layout dimensions when gbajs takes a
  // first look.
  $effect(() => {
    const b = bytes;
    if (!canvas) return;
    if (!b) return;
    // Guard against rebinding when the user toggles tabs.
    if (booted && gba && gba.hasRom()) return;
    requestAnimationFrame(() => loadCart(b));
  });

  // If the file changes out from under us (user closes the cart), pause
  // and let the parent reset state. We don't tear down the canvas because
  // Svelte unmounts the whole component when view !== 'game'.
  $effect(() => {
    return () => {
      if (gba && running) {
        try { gba.pause(); } catch { /* ignore */ }
      }
    };
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
    <button class="g-btn" type="button" onclick={play} disabled={!booted || running}>PLAY</button>
    <button class="g-btn" type="button" onclick={pause} disabled={!booted || !running}>PAUSE</button>
    <button class="g-btn" type="button" onclick={reset} disabled={!booted}>RESET</button>
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
  .g-canvas {
    border: 1px solid var(--rule);
    background: #000;
    image-rendering: pixelated;
    max-width: 100%;
    height: auto;
    outline: none;
  }
  .g-canvas:focus { border-color: var(--mint-deep); }

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
