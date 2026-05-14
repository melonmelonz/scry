<script>
  // Hex viewer with an inline entropy sparkline. The strip across the top
  // is one column per file block (normalized Shannon entropy 0..1); click
  // a column to jump there. Useful for spotting packed / encrypted regions
  // at a glance before reading the rows.
  import { ensureWasm } from './wasm.js';

  let { bytes, jumpTo = null } = $props();

  let offset = $state(0);
  const PAGE = 16 * 32; // 32 rows per page

  let rows = $state([]);
  let core = $state(null);
  let entropy = $state([]);
  let blockSize = $state(0);
  let gotoVal = $state('');

  // Cross-pane jump choreography. When an external jumpTo arrives we paint
  // the destination row with --tint-drop and fade it out over ~400ms. The
  // flash carries one `--fade` custom property the row's transition consumes.
  let flashOffset = $state(null);   // byte offset (rounded to row) being flashed
  let flashUntil = $state(0);       // performance.now() ms when fade ends
  let flashTick = $state(0);        // rerender pulse for the 400ms window
  let hoveredRow = $state(null);    // 0..rows.length-1 for hover tint
  const FLASH_MS = 400;

  $effect(() => {
    let cancelled = false;
    ensureWasm().then((c) => {
      if (cancelled) return;
      core = c;
      // Aim for ~256 columns across the strip so it reads as a sparkline.
      const target = 256;
      blockSize = Math.max(64, Math.ceil((bytes?.length ?? 0) / target));
      entropy = bytes ? core.entropy_blocks(bytes, blockSize) : [];
      render();
    });
    return () => { cancelled = true; };
  });

  // External "jump to offset" trigger (from Inspect tables). Scrolls the
  // destination row into the top third of the viewport and fires the flash.
  $effect(() => {
    if (jumpTo == null) return;
    const o = Math.max(0, Math.min((bytes?.length ?? 1) - 1, Number(jumpTo) | 0));
    const rowStart = Math.floor(o / 16) * 16;
    // Page the viewport so the target row exists in `rows`.
    const pageStart = Math.floor(rowStart / PAGE) * PAGE;
    offset = pageStart;
    render();
    flashOffset = rowStart;
    flashUntil = performance.now() + FLASH_MS;
    flashTick++;

    // Smooth-scroll the target row into top-third of the .grid viewport.
    // Defer until the rows have actually painted.
    requestAnimationFrame(() => {
      const grid = gridEl;
      if (!grid) return;
      const node = grid.querySelector(`[data-row-off="${rowStart}"]`);
      if (!node) return;
      const gridRect = grid.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      const targetOffset = nodeRect.top - gridRect.top - gridRect.height / 3;
      grid.scrollTo({ top: grid.scrollTop + targetOffset, behavior: 'smooth' });
    });
  });

  // Tick the flash window so the row's inline style decays smoothly even
  // without a Svelte state change. rAF until flashUntil; then clean up.
  $effect(() => {
    if (flashTick === 0) return;
    let raf = 0;
    const loop = () => {
      if (performance.now() >= flashUntil) {
        flashOffset = null;
        return;
      }
      flashTick = (flashTick + 1) & 0xfff;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });

  let gridEl = $state(null);

  function render() {
    if (!core || !bytes) return;
    rows = core.hex_rows(bytes, offset, PAGE);
  }

  function move(d) {
    offset = Math.max(0, Math.min((bytes?.length ?? 0) - 1, offset + d));
    offset = Math.floor(offset / 16) * 16;
    render();
  }

  function gotoOffset(e) {
    e.preventDefault();
    let v = gotoVal.trim();
    if (!v) return;
    if (v.startsWith('0x') || v.startsWith('0X')) v = v.slice(2);
    const n = parseInt(v, 16);
    if (!Number.isFinite(n)) return;
    offset = Math.max(0, Math.min((bytes?.length ?? 1) - 1, n));
    offset = Math.floor(offset / 16) * 16;
    render();
  }

  function clickEntropy(e) {
    if (!entropy.length || !bytes) return;
    const strip = e.currentTarget;
    const rect = strip.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const target = Math.floor(frac * bytes.length);
    offset = Math.floor(target / 16) * 16;
    render();
  }

  // The orange marker indicating current viewport position over the strip.
  let viewportFrac = $derived(
    bytes && bytes.length ? offset / bytes.length : 0
  );

  // Compute the per-row flash alpha (0..1) given the live flashTick.
  // The `_` parameter forces callers to pass `flashTick` so Svelte tracks
  // it as a reactive read and re-evaluates inline styles each rAF tick.
  function flashAlphaFor(rowOff, _tick) {
    if (flashOffset == null || rowOff !== flashOffset) return 0;
    const remaining = flashUntil - performance.now();
    if (remaining <= 0) return 0;
    return remaining / FLASH_MS;
  }

  // Each row in `rows` is a preformatted "00000000  ff ee ...  |....| " line.
  // We expose them as paired (offset, text) so we can set per-row attributes.
  let rowsWithOff = $derived.by(() => {
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      out.push({ off: offset + i * 16, text: rows[i] });
    }
    return out;
  });
</script>

<div class="wrap">
  <div class="bar">
    <span class="ti">[ HEX ]</span>
    <div class="ctl">
      <button onclick={() => move(-PAGE)}>◀ PAGE</button>
      <button onclick={() => move(-16)}>▲ ROW</button>
      <form class="goto" onsubmit={gotoOffset}>
        <span class="at">@</span>
        <input
          type="text"
          bind:value={gotoVal}
          placeholder={offset.toString(16).padStart(8, '0').toUpperCase()}
          aria-label="Jump to hex offset"
        />
      </form>
      <button onclick={() => move(16)}>▼ ROW</button>
      <button onclick={() => move(PAGE)}>PAGE ▶</button>
    </div>
  </div>

  {#if entropy.length > 1}
    <div class="strip-wrap">
      <span class="strip-label">ENTROPY</span>
      <div class="strip" onclick={clickEntropy} role="presentation" title="Click to jump">
        {#each entropy as e, i}
          <span class="strip-col" style="height: {Math.max(2, e * 100)}%; opacity: {0.35 + e * 0.65}"></span>
        {/each}
        <span class="strip-cursor" style="left: {viewportFrac * 100}%"></span>
      </div>
      <span class="strip-scale">{blockSize.toLocaleString()} B / col</span>
    </div>
  {/if}

  <pre class="grid" bind:this={gridEl}>{#each rowsWithOff as r, i}<span
      class="hex-row"
      class:hover={hoveredRow === i}
      class:flash={r.off === flashOffset}
      data-row-off={r.off}
      role="presentation"
      style={r.off === flashOffset ? `--flash-a: ${flashAlphaFor(r.off, flashTick)}` : ''}
      onmouseenter={() => (hoveredRow = i)}
      onmouseleave={() => (hoveredRow === i && (hoveredRow = null))}
    >{r.text}
</span>{/each}</pre>
</div>

<style>
  .wrap { display: flex; flex-direction: column; min-height: 0; gap: 8px; flex: 1; }
  .bar { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .ti {
    font-size: 10px;
    letter-spacing: 0.16em;
    color: var(--mint-deep);
    text-transform: uppercase;
  }
  .ctl { display: flex; gap: 6px; align-items: baseline; }
  .goto {
    display: inline-flex;
    align-items: baseline;
    border: 1px solid var(--rule);
    padding: 3px 6px;
    gap: 4px;
  }
  .goto:focus-within { border-color: var(--mint-deep); }
  .goto .at { color: var(--muted); font-size: 10px; }
  .goto input {
    font-family: inherit;
    font-size: 10px;
    color: var(--mint-deep);
    background: transparent;
    border: 0;
    outline: 0;
    width: 84px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  /* ─── Entropy strip ────────────────────────── */
  .strip-wrap {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 10px;
    font-size: 9px;
    letter-spacing: 0.14em;
    color: var(--muted);
    text-transform: uppercase;
  }
  .strip {
    position: relative;
    height: 28px;
    display: flex;
    align-items: flex-end;
    gap: 1px;
    background: var(--paper);
    border: 1px solid var(--rule);
    padding: 2px;
    cursor: crosshair;
    overflow: hidden;
  }
  .strip-col {
    flex: 1 1 auto;
    min-width: 1px;
    background: var(--mint-deep);
  }
  .strip-cursor {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--accent-system);
    pointer-events: none;
    transition: left var(--t-fast);
  }
  .strip-label { color: var(--mint-deep); }
  .strip-scale { color: var(--muted); }

  .grid {
    flex: 1;
    overflow: auto;
    min-height: 0;
    border: 1px solid var(--rule);
    background: var(--paper);
    padding: 10px;
    font-size: 11px;
    line-height: 1.45;
    white-space: pre;
    font-family: var(--mono);
  }
  /* Each row paints inline so background highlights snap to the row box. */
  .hex-row {
    display: block;
    background: transparent;
    transition: background 80ms ease;
    /* The flash background reads --flash-a; fading the alpha gives a calm
       fade-to-transparent over the rAF loop rather than a single jump. */
  }
  .hex-row.hover { background: var(--tint-row); }
  .hex-row.flash {
    /* --tint-drop is rgba already; we layer a fading rgba over it via alpha */
    background: color-mix(in srgb, var(--tint-drop) calc(var(--flash-a, 0) * 100%), transparent);
  }
</style>
