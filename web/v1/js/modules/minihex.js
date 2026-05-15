// Lightweight virtualized hex viewer used by the GAME pane.
//
// DOM-mirrors v2's MiniHex.svelte: same class names (mh-*), same structure,
// same cursor-highlight + follow-PC behaviour. v1 → v2 parity matters
// because the parent shell's mode toggle lets the user compare the two
// engines side by side; if they don't look identical the comparison
// degenerates into "why does this one look broken".
//
// Cap the physical container at 500K px (down from a previous 14M). The
// giant sizer was crashing memory-pressured renderers when a 16 MiB cart
// landed; 500K px lays out instantly. Scrollbar resolution on a 16 MiB
// cart drops to ~33 bytes per scrollbar pixel — the JUMP input handles
// row-precision navigation.

import { el } from '../dom.js';
import { hex2, hex8, asciiCh } from '../fmt.js';
import { GBA_HEADER_OVERLAY, findOverlayAt, decodeField, formatDecoded } from '../hex/overlays.js';

const ROW_BYTES = 16;
const ROW_HEIGHT = 20;
const OVERSCAN = 6;
const MAX_PHYSICAL_PX = 2_000_000;

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

function byteDetail(b, off) {
  if (!b || off < 0 || off >= b.byteLength) return null;
  const v = b[off];
  const ascii = asciiCh(v);
  const u16 = off + 1 < b.byteLength ? (b[off] | (b[off + 1] << 8)) : null;
  const u32 = off + 3 < b.byteLength
    ? ((b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0)
    : null;
  return { off, v, ascii, u16, u32 };
}

function buildRowCells(rowIdx, b) {
  const off = rowIdx * ROW_BYTES;
  const end = Math.min(b.byteLength, off + ROW_BYTES);
  const hex = [];
  const asc = [];
  for (let i = off; i < end; i++) {
    hex.push({ off: i, text: hex2(b[i]), gap: i - off === 7 ? 'wide' : '' });
    asc.push({ off: i, text: asciiCh(b[i]) });
  }
  return { addr: hex8(off), hex, asc };
}

function paintCellRun(host, cells, selectedOffset, cursorOffset, hotField) {
  host.textContent = '';
  cells.forEach((cell, idx) => {
    const f = findOverlayAt(GBA_HEADER_OVERLAY, cell.off);
    const classes = ['mh-cell'];
    if (f) classes.push('mh-ovr');
    if (hotField && f === hotField) classes.push('mh-hot');
    if (cell.off === selectedOffset) classes.push('mh-selected');
    if (cell.off === cursorOffset) classes.push('mh-pc-byte');
    const s = el('span', {
      class: classes.join(' '),
      dataset: { off: String(cell.off) },
      text: cell.text,
    });
    host.appendChild(s);
    if (idx < cells.length - 1) {
      host.appendChild(document.createTextNode(cell.gap === 'wide' ? '  ' : ' '));
    }
  });
}

function paintAsciiRun(host, cells, selectedOffset, cursorOffset, hotField) {
  host.textContent = '';
  cells.forEach(cell => {
    const f = findOverlayAt(GBA_HEADER_OVERLAY, cell.off);
    const classes = ['mh-char'];
    if (f) classes.push('mh-ovr');
    if (hotField && f === hotField) classes.push('mh-hot');
    if (cell.off === selectedOffset) classes.push('mh-selected');
    if (cell.off === cursorOffset) classes.push('mh-pc-byte');
    host.appendChild(el('span', {
      class: classes.join(' '),
      dataset: { off: String(cell.off) },
      text: cell.text,
    }));
  });
}

export function createMiniHex(opts = {}) {
  const onByteClick = typeof opts.onByteClick === 'function' ? opts.onByteClick : null;
  const host = el('section', { class: 'mh-host' });

  const title = el('span', { class: 'mh-title', text: 'ROM (empty)' });
  const jumpInput = el('input', {
    type: 'text', placeholder: '0x...', class: 'mh-jump',
    'aria-label': 'jump to offset',
  });
  const jumpForm = el('form', { class: 'mh-jumpform' }, [
    el('span', { class: 'mh-jumplab', text: 'JUMP' }),
    jumpInput,
  ]);
  const bar = el('div', { class: 'mh-bar' }, [title, jumpForm]);

  const sizer = el('div', { class: 'mh-sizer' });
  const scroll = el('div', { class: 'mh-scroll' }, [sizer]);
  const detail = el('div', { class: 'mh-detail', text: 'select a byte' });

  host.appendChild(bar);
  host.appendChild(scroll);
  host.appendChild(detail);

  let bytes = null;
  let viewportHeight = 0;
  let rowPool = [];
  let geom = { physicalPx: 0, scale: 1 };
  let cursorRow = -1;
  let cursorOffset = -1;
  let selectedOffset = -1;
  let followOn = false;
  let hoveredField = null;

  function ensurePool(n) {
    while (rowPool.length < n) {
      const row = el('div', { class: 'mh-row' }, [
        el('span', { class: 'mh-addr' }),
        el('span', { class: 'mh-bytes' }),
        el('span', { class: 'mh-ascii' }),
      ]);
      row.style.position = 'absolute';
      row.style.left = '0';
      row.style.right = '0';
      row.style.height = `${ROW_HEIGHT}px`;
      rowPool.push(row);
    }
  }

  function render() {
    if (!bytes) {
      for (const r of rowPool) if (r.parentNode) r.remove();
      sizer.style.height = '0px';
      title.textContent = 'ROM (empty)';
      return;
    }
    const totalRows = Math.ceil(bytes.byteLength / ROW_BYTES);
    geom = virtualGeometry(totalRows, ROW_HEIGHT);
    sizer.style.height = `${geom.physicalPx}px`;

    const range = visibleRange(scroll.scrollTop, viewportHeight, totalRows, geom.scale);
    const count = range.end - range.start;
    ensurePool(count);

    for (let i = count; i < rowPool.length; i++) {
      if (rowPool[i].parentNode) rowPool[i].remove();
    }

    for (let i = 0; i < count; i++) {
      const rowIdx = range.start + i;
      const cells = buildRowCells(rowIdx, bytes);
      const node = rowPool[i];
      node.style.top = `${range.topPx + i * ROW_HEIGHT}px`;
      const [a, h, c] = node.children;
      a.textContent = cells.addr;
      paintCellRun(h, cells.hex, selectedOffset, cursorOffset, hoveredField);
      paintAsciiRun(c, cells.asc, selectedOffset, cursorOffset, hoveredField);
      node.classList.toggle('mh-cursor', rowIdx === cursorRow);
      if (node.parentNode !== sizer) sizer.appendChild(node);
    }
    renderDetail();
  }

  function scrollCursorIntoView() {
    if (!bytes || cursorRow < 0) return;
    const virtualY = cursorRow * ROW_HEIGHT;
    const physicalY = virtualY / (geom.scale || 1);
    const margin = ROW_HEIGHT * 4;
    const top = scroll.scrollTop;
    const bottom = top + viewportHeight;
    if (physicalY < top + margin || physicalY > bottom - margin) {
      scroll.scrollTop = Math.max(0, (virtualY - viewportHeight / 2) / (geom.scale || 1));
    }
  }

  function jumpTo(off) {
    if (!bytes || off < 0 || off >= bytes.byteLength) return;
    const row = Math.floor(off / ROW_BYTES);
    const virtualY = row * ROW_HEIGHT;
    scroll.scrollTop = Math.max(0, (virtualY - viewportHeight / 2) / (geom.scale || 1));
    render();
  }

  function setBytes(b) {
    bytes = b;
    cursorRow = -1;
    cursorOffset = -1;
    selectedOffset = -1;
    scroll.scrollTop = 0;
    title.textContent = b ? `ROM (${b.byteLength.toLocaleString()} bytes)` : 'ROM (empty)';
    render();
  }

  function setCursor(off) {
    if (!bytes) { cursorRow = -1; cursorOffset = -1; return; }
    const newRow = (typeof off === 'number' && off >= 0 && off < bytes.byteLength)
      ? Math.floor(off / ROW_BYTES) : -1;
    const newOffset = newRow >= 0 ? off : -1;
    if (newRow === cursorRow && newOffset === cursorOffset) {
      if (followOn) requestAnimationFrame(scrollCursorIntoView);
      return;
    }
    cursorRow = newRow;
    cursorOffset = newOffset;
    render();
    if (followOn) requestAnimationFrame(scrollCursorIntoView);
  }

  function setFollow(on) {
    const flipped = on !== followOn;
    followOn = on;
    if (flipped && on) {
      render();
      requestAnimationFrame(scrollCursorIntoView);
    }
  }

  function renderDetail() {
    const off = selectedOffset >= 0 ? selectedOffset : cursorOffset;
    const f = findOverlayAt(GBA_HEADER_OVERLAY, off);
    if (f && bytes) {
      const v = decodeField(bytes, f);
      detail.textContent = `${f.name} \u00B7 ${formatDecoded(v, f)}${f.description ? ' \u00B7 ' + f.description : ''}`;
      return;
    }
    const d = byteDetail(bytes, off);
    if (!d) {
      detail.textContent = bytes ? 'select a byte' : 'no ROM loaded';
      return;
    }
    const bin = d.v.toString(2).padStart(8, '0');
    const bits = [
      `OFF ${hex8(d.off)}`,
      `BYTE 0x${hex2(d.v)} (${d.v})`,
      `b${bin}`,
      `ASCII '${d.ascii}'`,
    ];
    if (d.u16 !== null) bits.push(`U16LE 0x${d.u16.toString(16).toUpperCase().padStart(4, '0')}`);
    if (d.u32 !== null) bits.push(`U32LE 0x${d.u32.toString(16).toUpperCase().padStart(8, '0')}`);
    detail.textContent = bits.join(' \u00B7 ');
  }

  jumpForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = jumpInput.value.trim().replace(/^0x/i, '');
    const n = parseInt(raw, 16);
    if (Number.isFinite(n)) jumpTo(n);
  });

  scroll.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-off]');
    if (!t || !bytes) return;
    const off = Number(t.dataset.off);
    const f = findOverlayAt(GBA_HEADER_OVERLAY, off);
    if (f !== hoveredField) {
      hoveredField = f;
      render();
    }
  });
  scroll.addEventListener('mouseleave', () => {
    if (hoveredField) { hoveredField = null; render(); }
  });

  scroll.addEventListener('click', (e) => {
    const t = e.target.closest('[data-off]');
    if (!t || !bytes) return;
    const off = Number(t.dataset.off);
    if (!Number.isFinite(off) || off < 0 || off >= bytes.byteLength) return;
    selectedOffset = off;
    render();
    if (onByteClick) onByteClick(off);
  });

  scroll.addEventListener('scroll', render, { passive: true });
  const ro = new ResizeObserver(() => {
    viewportHeight = scroll.clientHeight;
    render();
  });
  ro.observe(scroll);

  return { host, setBytes, setCursor, setFollow, jumpTo };
}
