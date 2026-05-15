<script>
  // Lightweight virtualized hex viewer for the GAME pane. Mirrors v1's
  // createMiniHex: no entropy compute, no overlays, no tooltips — just rows
  // of bytes you can scroll while the emulator runs (or is paused).
  //
  // Uses the same capped-physical-height trick as the main HEX module:
  // browsers blow up on 20M-pixel layout boxes (Safari ~16M, Firefox ~17.9M),
  // so we cap container height at 14M physical px and scale the scroll-to-
  // virtual-offset mapping when the cart is larger than that. Rows are
  // absolute-positioned inside a sizer div.

  import { onMount, onDestroy, untrack } from 'svelte';

  let { bytes, cursor = null, follow = false, onByteClick = null } = $props();

  const ROW_BYTES = 16;
  const ROW_HEIGHT = 20;
  const OVERSCAN = 6;
  // 500K px. The previous 14M cap kept scrollbar resolution row-precise
  // for huge files but the giant sizer itself was crashing memory-pressured
  // browsers when the GAME pane first laid out a 16 MiB cart's mini-hex
  // (visible as "the page killed my computer"). 500K lays out instantly;
  // scrollbar resolution drops to ~33 bytes/px on a 16 MiB cart, but the
  // GAME pane has its own jump-to-offset input and PgUp/PgDn for precise
  // navigation.
  const MAX_PHYSICAL_PX = 500_000;

  let scroll;
  let sizer;
  let jumpInput;
  let viewportHeight = 0;
  let rowPool = [];
  let lastBytes = null;
  let geom = { physicalPx: 0, scale: 1 };
  let lastCursorRow = -1;
  let selectedOffset = $state(null);

  function hex2(n) { return (n >>> 0).toString(16).padStart(2, '0').toUpperCase(); }
  function hex8(n) { return '0x' + (n >>> 0).toString(16).padStart(8, '0').toUpperCase(); }
  function asciiCh(n) { return (n >= 0x20 && n <= 0x7E) ? String.fromCharCode(n) : '.'; }

  const GBA_HEADER_OVERLAY = [
    { offset: 0x000, size: 4,   name: 'entry.branch',     type: 'bytes',  description: 'ARM branch' },
    { offset: 0x004, size: 156, name: 'nintendo.logo',     type: 'bytes',  description: 'Nintendo logo bitmap' },
    { offset: 0x0A0, size: 12,  name: 'game.title',        type: 'string', description: 'Cartridge title' },
    { offset: 0x0AC, size: 4,   name: 'game.code',         type: 'string', description: 'Game code' },
    { offset: 0x0B0, size: 2,   name: 'maker.code',        type: 'string', description: 'Maker code' },
    { offset: 0x0B2, size: 1,   name: 'fixed.0x96',        type: 'u8',     description: 'BIOS fixed byte' },
    { offset: 0x0B3, size: 1,   name: 'unit.code',         type: 'u8' },
    { offset: 0x0B4, size: 1,   name: 'device.type',       type: 'u8' },
    { offset: 0x0B5, size: 7,   name: 'reserved',          type: 'bytes' },
    { offset: 0x0BC, size: 1,   name: 'software.version',  type: 'u8' },
    { offset: 0x0BD, size: 1,   name: 'complement.checksum', type: 'u8', description: 'Header checksum' },
    { offset: 0x0BE, size: 2,   name: 'reserved.tail',     type: 'bytes' },
  ];

  function findOverlayAt(off) {
    for (const f of GBA_HEADER_OVERLAY) {
      if (off >= f.offset && off < f.offset + f.size) return f;
    }
    return null;
  }

  function readOverlayValue(f) {
    if (!bytes || f.offset + f.size > bytes.byteLength) return '-';
    if (f.type === 'string') {
      return Array.from(bytes.subarray(f.offset, f.offset + f.size))
        .map(b => b >= 0x20 && b <= 0x7E ? String.fromCharCode(b) : '.').join('').trim();
    }
    if (f.type === 'u8') return `0x${hex2(bytes[f.offset])} (${bytes[f.offset]})`;
    return Array.from(bytes.subarray(f.offset, f.offset + f.size)).map(hex2).join(' ');
  }

  let hoveredField = $state(null);

  function virtualGeometry(totalRows, rowHeight) {
    const naturalPx = Math.max(0, totalRows * rowHeight);
    if (naturalPx <= MAX_PHYSICAL_PX) return { physicalPx: naturalPx, scale: 1 };
    return { physicalPx: MAX_PHYSICAL_PX, scale: naturalPx / MAX_PHYSICAL_PX };
  }

  function visibleRange(scrollTop, vh, totalRows, scale) {
    if (totalRows === 0) return { start: 0, end: 0, topPx: 0 };
    const virtualScrollTop = scrollTop * scale;
    const visibleCount = Math.ceil(vh / ROW_HEIGHT) + OVERSCAN * 2;
    const rawStart = Math.floor(virtualScrollTop / ROW_HEIGHT) - OVERSCAN;
    const start = Math.max(0, rawStart);
    const end = Math.min(totalRows, start + visibleCount);
    let topPx;
    if (scale === 1) {
      topPx = start * ROW_HEIGHT;
    } else {
      const remainder = virtualScrollTop - start * ROW_HEIGHT;
      topPx = scrollTop - remainder / scale;
    }
    return { start, end, topPx };
  }

  function buildRowCells(rowIdx, b) {
    const off = rowIdx * ROW_BYTES;
    const end = Math.min(b.byteLength, off + ROW_BYTES);
    const slice = b.subarray(off, end);
    const hexCells = [];
    const ascCells = [];
    for (let i = 0; i < slice.length; i++) {
      const pos = off + i;
      hexCells.push({ off: pos, text: hex2(slice[i]), gap: i === 7 ? 'wide' : '' });
      ascCells.push({ off: pos, text: asciiCh(slice[i]) });
    }
    return { addr: hex8(off), hex: hexCells, asc: ascCells };
  }

  function paintRun(host, cells, cls, cursorOffset) {
    host.textContent = '';
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const s = document.createElement('span');
      s.className = cls;
      const f = findOverlayAt(cell.off);
      if (f) s.classList.add('mh-ovr');
      if (hoveredField && f === hoveredField) s.classList.add('mh-hot');
      if (cell.off === selectedOffset) s.classList.add('mh-selected');
      if (cell.off === cursorOffset) s.classList.add('mh-pc-byte');
      s.dataset.off = String(cell.off);
      s.textContent = cell.text;
      host.appendChild(s);
      if (cls === 'mh-cell' && i < cells.length - 1) {
        host.appendChild(document.createTextNode(cell.gap === 'wide' ? '  ' : ' '));
      }
    }
  }

  function selectedDetail() {
    const off = selectedOffset ?? cursor;
    if (!bytes || typeof off !== 'number' || off < 0 || off >= bytes.byteLength) return null;
    const f = findOverlayAt(off);
    if (f) {
      const v = readOverlayValue(f);
      return `${f.name} \u00B7 ${v}${f.description ? ' \u00B7 ' + f.description : ''}`;
    }
    const v = bytes[off];
    const bin = v.toString(2).padStart(8, '0');
    const u16 = off + 1 < bytes.byteLength ? (bytes[off] | (bytes[off + 1] << 8)) : null;
    const u32 = off + 3 < bytes.byteLength
      ? ((bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0)
      : null;
    const parts = [
      `OFF ${hex8(off)}`,
      `BYTE 0x${hex2(v)} (${v})`,
      `b${bin}`,
      `ASCII '${asciiCh(v)}'`,
    ];
    if (u16 !== null) parts.push(`U16LE 0x${u16.toString(16).toUpperCase().padStart(4, '0')}`);
    if (u32 !== null) parts.push(`U32LE 0x${u32.toString(16).toUpperCase().padStart(8, '0')}`);
    return parts.join(' \u00B7 ');
  }

  function ensurePool(n) {
    while (rowPool.length < n) {
      const row = document.createElement('div');
      row.className = 'mh-row';
      row.style.position = 'absolute';
      row.style.left = '0';
      row.style.right = '0';
      row.style.height = `${ROW_HEIGHT}px`;
      const a = document.createElement('span'); a.className = 'mh-addr';
      const h = document.createElement('span'); h.className = 'mh-bytes';
      const c = document.createElement('span'); c.className = 'mh-ascii';
      row.appendChild(a); row.appendChild(h); row.appendChild(c);
      rowPool.push(row);
    }
  }

  function render() {
    const b = bytes;
    if (!sizer) return;
    if (!b || b.byteLength === 0) {
      for (const r of rowPool) { if (r.parentNode) r.remove(); }
      sizer.style.height = '0px';
      return;
    }
    const totalRows = Math.ceil(b.byteLength / ROW_BYTES);
    geom = virtualGeometry(totalRows, ROW_HEIGHT);
    sizer.style.height = `${geom.physicalPx}px`;

    const range = visibleRange(scroll.scrollTop, viewportHeight, totalRows, geom.scale);
    const count = range.end - range.start;
    ensurePool(count);

    for (let i = count; i < rowPool.length; i++) {
      if (rowPool[i].parentNode) rowPool[i].remove();
    }
    const cursorRow = (typeof cursor === 'number' && cursor >= 0 && cursor < b.byteLength)
      ? Math.floor(cursor / ROW_BYTES)
      : -1;

    for (let i = 0; i < count; i++) {
      const rowIdx = range.start + i;
      const cells = buildRowCells(rowIdx, b);
      const node = rowPool[i];
      node.style.top = `${range.topPx + i * ROW_HEIGHT}px`;
      const [a, h, c] = node.children;
      a.textContent = cells.addr;
      paintRun(h, cells.hex, 'mh-cell', cursor);
      paintRun(c, cells.asc, 'mh-char', cursor);
      if (rowIdx === cursorRow) node.classList.add('mh-cursor');
      else node.classList.remove('mh-cursor');
      if (node.parentNode !== sizer) sizer.appendChild(node);
    }
  }

  function scrollCursorIntoView() {
    const b = bytes;
    if (!b || typeof cursor !== 'number' || cursor < 0 || cursor >= b.byteLength) return;
    if (!scroll) return;
    const row = Math.floor(cursor / ROW_BYTES);
    const virtualY = row * ROW_HEIGHT;
    const physicalY = virtualY / geom.scale;
    const margin = ROW_HEIGHT * 4;
    const top = scroll.scrollTop;
    const bottom = top + viewportHeight;
    if (physicalY < top + margin || physicalY > bottom - margin) {
      // Target the *virtual* scroll position that centers the cursor, then
      // convert that to physical. Naive `physicalY - vh/2` works at scale=1
      // but drifts off-screen at higher scales because the half-viewport
      // subtraction is in physical px while physicalY is already scaled.
      scroll.scrollTop = Math.max(0, (virtualY - viewportHeight / 2) / geom.scale);
    }
  }

  function jumpTo(off) {
    const b = bytes;
    if (!b || off < 0 || off >= b.byteLength) return;
    selectedOffset = off;
    const row = Math.floor(off / ROW_BYTES);
    const virtualY = row * ROW_HEIGHT;
    scroll.scrollTop = Math.max(0, (virtualY - viewportHeight / 2) / geom.scale);
    render();
  }

  function onSubmitJump(e) {
    e.preventDefault();
    const raw = jumpInput.value.trim().replace(/^0x/i, '');
    const n = parseInt(raw, 16);
    if (Number.isFinite(n)) jumpTo(n);
  }

  function onScrollClick(e) {
    const t = e.target.closest('[data-off]');
    if (!t || !bytes) return;
    const off = Number(t.dataset.off);
    if (!Number.isFinite(off) || off < 0 || off >= bytes.byteLength) return;
    selectedOffset = off;
    render();
    onByteClick?.(off);
  }

  function onScrollKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target.closest('[data-off]');
    if (!t) return;
    e.preventDefault();
    onScrollClick(e);
  }

  function onScrollHover(e) {
    const t = e.target.closest('[data-off]');
    if (!t || !bytes) return;
    const off = Number(t.dataset.off);
    const f = findOverlayAt(off);
    if (f !== hoveredField) { hoveredField = f; render(); }
  }
  function onScrollLeave() {
    if (hoveredField) { hoveredField = null; render(); }
  }

  let ro;
  onMount(() => {
    ro = new ResizeObserver(() => {
      viewportHeight = scroll.clientHeight;
      render();
    });
    ro.observe(scroll);
    scroll.addEventListener('scroll', render, { passive: true });
    render();
  });
  onDestroy(() => { try { ro?.disconnect(); } catch (_) {} });

  // React to byte changes: reset scroll position and land on the cart header.
  // Reading `bytes` here registers this effect; the render() and jumpTo()
  // calls are wrapped in untrack() so they don't pull cursor/hoveredField/
  // selectedOffset into this effect's dependency set (which would cause it
  // to re-fire on every cursor move and reset scroll position).
  $effect(() => {
    if (bytes !== lastBytes) {
      lastBytes = bytes;
      lastCursorRow = -1;
      selectedOffset = null;
      if (scroll) scroll.scrollTop = 0;
      untrack(() => render());
      // Jump to the cartridge header on first paint of a new ROM.
      if (bytes && bytes.byteLength >= 0xC0) {
        requestAnimationFrame(() => jumpTo(0xA0));
      }
    }
  });

  // Cursor tracker: repaint when the cursor row changes, optionally chase it
  // if follow mode is on. Reading `cursor`/`follow` here registers the effect
  // for Svelte's reactive graph. render()/scrollCursorIntoView() are wrapped
  // in untrack() so they don't pull hoveredField/selectedOffset into this
  // effect (which would make cursor-row changes re-fire on hover or click).
  let lastFollow = false;
  $effect(() => {
    const c = cursor;
    const f = follow;
    if (!bytes) return;
    const row = (typeof c === 'number' && c >= 0 && c < bytes.byteLength)
      ? Math.floor(c / ROW_BYTES) : -1;
    const followFlipped = f !== lastFollow;
    lastFollow = f;
    if (row === lastCursorRow && !followFlipped) return;
    lastCursorRow = row;
    untrack(() => render());
    // Snap on cursor move (when following) OR on the moment FOLLOW flips on,
    // so the user sees something happen the instant they hit the toggle.
    if (f) requestAnimationFrame(scrollCursorIntoView);
  });
</script>

<section class="mh-host">
  <div class="mh-bar">
    <span class="mh-title">
      {bytes ? `ROM (${bytes.byteLength.toLocaleString()} bytes)` : 'ROM (empty)'}
    </span>
    <form class="mh-jumpform" onsubmit={onSubmitJump}>
      <span class="mh-jumplab">JUMP</span>
      <input bind:this={jumpInput} type="text" placeholder="0x..." class="mh-jump" aria-label="jump to offset" />
    </form>
  </div>
  <div class="mh-scroll" bind:this={scroll} role="grid" tabindex="0" onclick={onScrollClick} onkeydown={onScrollKeydown} onmouseover={onScrollHover} onmouseleave={onScrollLeave}>
    <div class="mh-sizer" bind:this={sizer}></div>
  </div>
  <div class="mh-detail">{selectedDetail() ?? (bytes ? 'select a byte' : 'no ROM loaded')}</div>
</section>

<style>
  .mh-host {
    display: flex; flex-direction: column;
    min-height: 0; height: 100%;
    border: 1px solid var(--rule);
    background: var(--paper);
  }
  .mh-bar {
    display: flex; align-items: center; justify-content: space-between;
    gap: 10px; padding: 8px 10px;
    border-bottom: 1px solid var(--rule);
    font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
  }
  .mh-title { color: var(--muted); }
  .mh-jumpform { display: flex; align-items: center; gap: 6px; }
  .mh-jumplab { color: var(--muted); font-size: 9px; }
  .mh-jump {
    font-family: inherit; font-size: 10px;
    background: transparent; color: var(--ink);
    border: 1px solid var(--rule);
    padding: 3px 6px; width: 11ch;
  }
  .mh-jump:focus { outline: 1px solid var(--mint-deep); border-color: var(--mint-deep); }

  .mh-scroll {
    flex: 1; min-height: 0;
    overflow-y: auto; overflow-x: hidden;
    position: relative;
    padding: 6px 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px; line-height: 20px;
    color: var(--ink);
  }
  .mh-sizer { position: relative; width: 100%; }
  :global(.mh-row) {
    display: grid;
    grid-template-columns: 90px 1fr 18ch;
    gap: 14px;
    padding: 0 10px;
    white-space: nowrap;
  }
  :global(.mh-row .mh-addr) { color: var(--muted); }
  :global(.mh-row .mh-bytes) { letter-spacing: 0.04em; }
  :global(.mh-row .mh-ascii) { color: var(--muted); }
  :global(.mh-cell), :global(.mh-char) { cursor: pointer; padding: 0 1px; }
  :global(.mh-cell:hover), :global(.mh-char:hover) { background: var(--mint); color: var(--ink); }
  :global(.mh-cell.mh-selected), :global(.mh-char.mh-selected) {
    background: var(--mint-deep);
    color: var(--paper);
  }
  :global(.mh-cell.mh-pc-byte), :global(.mh-char.mh-pc-byte) {
    outline: 1px solid var(--mint-deep);
    outline-offset: -1px;
  }
  :global(.mh-row.mh-cursor) { background: var(--mint-pale); }
  :global(.mh-row.mh-cursor .mh-addr),
  :global(.mh-row.mh-cursor .mh-ascii) { color: var(--ink); }
  .mh-detail {
    border-top: 1px solid var(--rule);
    padding: 7px 10px;
    min-height: 30px;
    color: var(--muted);
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  @keyframes mh-pc-pulse {
    0%, 100% { outline-color: var(--mint-deep); }
    50%      { outline-color: transparent; }
  }
  :global(.mh-cell.mh-pc-byte), :global(.mh-char.mh-pc-byte) {
    animation: mh-pc-pulse 1.2s ease-in-out infinite;
  }
  @keyframes mh-byte-pop {
    0%  { transform: scale(1); }
    40% { transform: scale(1.3); }
    100% { transform: scale(1); }
  }
  :global(.mh-cell.mh-selected), :global(.mh-char.mh-selected) {
    animation: mh-byte-pop 200ms ease-out;
  }
  :global(.mh-cell.mh-ovr), :global(.mh-char.mh-ovr) {
    background: var(--mint-pale);
  }
  :global(.mh-cell.mh-ovr:hover), :global(.mh-char.mh-ovr:hover) {
    background: var(--mint); cursor: help;
  }
  :global(.mh-cell.mh-hot), :global(.mh-char.mh-hot) {
    background: var(--mint);
  }
</style>
