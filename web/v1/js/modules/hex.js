// HEX pane — virtualized hex viewer with per-byte hover/select/flash and an
// entropy strip across the top.
//
//   - rows are absolutely positioned inside a capped sizer so very large
//     files (16 MiB GBA carts) don't blow the 17M-px-per-element render limit
//   - per-byte cells carry data-fi (file offset). overlay highlight uses
//     .ovr/.hot; click-select uses .sel; jump-to flashes both row + cells.
//   - entropy strip is 64 click-to-jump bars + a viewport-tracking marker.
//   - cross-pane: INSPECT publishes navStore { route:'hex', address, len }
//     and we scroll + flash to the byte range.

import { fileStore } from '../stores/file.js';
import { detectFormat } from '../format/detect.js';
import { visibleRange, virtualGeometry } from '../hex/virtualize.js';
import { pickOverlay, findOverlayAt, decodeField, formatDecoded } from '../hex/overlays.js';
import { entropyBlocks, blockOffset } from '../hex/entropy.js';
import { el, replaceChildren } from '../dom.js';
import { setHint, clearHint } from '../stores/hint.js';
import { navStore } from '../stores/nav.js';
import { gamePcStore } from '../stores/gamepc.js';
import { hex2, hex8, asciiCh } from '../fmt.js';

const ROW_HEIGHT = 20;
const BYTES_PER_ROW = 16;
const OVERSCAN = 6;
const ENTROPY_BLOCKS = 64;

function buildRow(rowAddr, rowOffset, bytes, overlays) {
  const addr = el('span', { class: 'addr', text: hex8(rowAddr) });
  const bytesSpan = el('span', { class: 'bytes' });
  const asciiSpan = el('span', { class: 'ascii' });

  for (let i = 0; i < bytes.length; i++) {
    const fileOffset = rowOffset + i;
    const f = findOverlayAt(overlays, fileOffset);
    const cls = f ? 'ovr' : '';
    bytesSpan.appendChild(el('span', {
      class: cls,
      dataset: { fi: String(fileOffset) },
      text: hex2(bytes[i])
    }));
    asciiSpan.appendChild(el('span', {
      class: cls,
      dataset: { fi: String(fileOffset) },
      text: asciiCh(bytes[i])
    }));
    if (i === 7) {
      bytesSpan.appendChild(el('span', { class: 'mid' }));
      asciiSpan.appendChild(el('span', { class: 'mid' }));
    }
    if (i < bytes.length - 1) {
      bytesSpan.appendChild(document.createTextNode(' '));
    }
  }
  return [addr, bytesSpan, asciiSpan];
}

function buildTip(field, bytes) {
  const v = decodeField(bytes, field);
  const head = el('div', { class: 'head' }, [
    el('span', { class: 'l', text: 'FIELD' }),
    el('span', { class: 'n', text: field.name })
  ]);
  const rows = [
    ['OFFSET', '0x' + field.offset.toString(16).padStart(2, '0').toUpperCase()],
    ['TYPE', field.type + (field.endian ? ' ' + field.endian : '')]
  ].map(([l, val]) => el('div', { class: 'row' }, [
    el('span', { class: 'l', text: l }),
    el('span', { class: 'v', text: val })
  ]));
  const valueRow = el('div', { class: 'row' }, [
    el('span', { class: 'l', text: 'VALUE' }),
    el('span', { class: 'v mint', text: formatDecoded(v, field) })
  ]);
  const children = [head, ...rows, valueRow];
  if (field.description) {
    children.push(el('p', { class: 'desc', text: field.description }));
  }
  return el('div', { class: 'tip' }, children);
}

export function createHex() {
  const titleEl = el('span', { class: 'title', text: 'HEX' });
  const input = el('input', { type: 'text', placeholder: '0x00000000', spellcheck: 'false', autocomplete: 'off' });
  const form = el('form', {}, [
    el('label', { class: 'lab', text: 'GOTO' }),
    input
  ]);
  const bar = el('header', { class: 'hex-bar' }, [titleEl, form]);

  const entropyBars = el('div', { class: 'hex-entropy-bars' });
  const entropyMarker = el('div', { class: 'hex-entropy-marker' });
  const entropyStrip = el('div', { class: 'hex-entropy' }, [entropyBars, entropyMarker]);

  // Capped-sizer virtualization: a scroll container with a single
  // position:relative sizer inside, and rows absolutely positioned at
  // computed top px. This stays under any browser's per-element height
  // limit even for 16 MiB carts.
  const scroll = el('div', { class: 'hex-scroll' });
  const sizer = document.createElement('div');
  sizer.style.position = 'relative';
  sizer.style.width = '100%';
  scroll.appendChild(sizer);

  const tipHost = el('div', { class: 'tip-host' });
  const wrap = el('section', { class: 'hex-wrap' }, [bar, entropyStrip, scroll, tipHost]);

  let scrollTop = 0;
  let viewportHeight = 400;
  let rowPool = [];
  let geom = { physicalPx: 0, scale: 1 };
  let hoveredField = null;
  let selectedOffset = -1;
  let pendingFlash = null;

  function bytes() {
    return fileStore.get().bytes ?? new Uint8Array(0);
  }
  function overlays() {
    const b = bytes();
    if (b.byteLength === 0) return [];
    return pickOverlay(detectFormat(b));
  }
  function totalRows() {
    return Math.ceil(bytes().byteLength / BYTES_PER_ROW);
  }
  function ensureRowPool(n) {
    while (rowPool.length < n) {
      const r = document.createElement('div');
      r.style.position = 'absolute';
      r.style.left = '0';
      r.style.right = '0';
      r.style.height = `${ROW_HEIGHT}px`;
      rowPool.push(r);
    }
  }

  function render() {
    const b = bytes();
    const ov = overlays();
    const tr = totalRows();
    titleEl.textContent = `HEX \u00B7 ${b.byteLength.toLocaleString()} bytes`;

    geom = virtualGeometry(tr, ROW_HEIGHT);
    sizer.style.height = `${geom.physicalPx}px`;

    const range = visibleRange({
      scrollTop, viewportHeight,
      rowHeight: ROW_HEIGHT, totalRows: tr, overscan: OVERSCAN,
      scale: geom.scale
    });

    const count = range.end - range.start;
    ensureRowPool(count);

    for (let i = count; i < rowPool.length; i++) {
      if (rowPool[i].parentNode) rowPool[i].remove();
    }

    for (let i = 0; i < count; i++) {
      const rowIdx = range.start + i;
      const startByte = rowIdx * BYTES_PER_ROW;
      const endByte = Math.min(startByte + BYTES_PER_ROW, b.byteLength);
      const slice = b.subarray(startByte, endByte);
      const node = rowPool[i];
      node.className = 'hex-row';
      node.dataset.row = String(rowIdx);
      node.style.top = `${range.topPx + i * ROW_HEIGHT}px`;
      replaceChildren(node, buildRow(startByte, startByte, slice, ov));
      if (node.parentNode !== sizer) sizer.appendChild(node);
    }
    paintHotCells();
    updateMarker();
  }

  function paintHotCells() {
    const all = sizer.querySelectorAll('.ovr');
    if (!hoveredField) {
      all.forEach(n => n.classList.remove('hot'));
    } else {
      const start = hoveredField.offset;
      const end = hoveredField.offset + hoveredField.size;
      all.forEach(n => {
        const fi = Number(n.dataset.fi);
        n.classList.toggle('hot', fi >= start && fi < end);
      });
    }
    const cells = sizer.querySelectorAll('[data-fi]');
    cells.forEach(n => {
      n.classList.toggle('sel', Number(n.dataset.fi) === selectedOffset);
    });
  }

  function pushSelectionHint() {
    const b = bytes();
    if (selectedOffset < 0 || selectedOffset >= b.byteLength) {
      clearHint('hex');
      return;
    }
    const v = b[selectedOffset];
    const ascii = (v >= 0x20 && v <= 0x7E) ? String.fromCharCode(v) : '.';
    const bin = v.toString(2).padStart(8, '0');
    setHint('hex', `OFF ${hex8(selectedOffset)} \u00B7 BYTE 0x${hex2(v)} (${v}) \u00B7 b${bin} \u00B7 '${ascii}'`);
  }

  function renderTip() {
    if (!hoveredField) {
      replaceChildren(tipHost, []);
      return;
    }
    replaceChildren(tipHost, [buildTip(hoveredField, bytes())]);
  }

  // ─── Entropy strip ───────────────────────────
  function buildEntropy() {
    const b = bytes();
    if (b.byteLength === 0) {
      replaceChildren(entropyBars, []);
      entropyStrip.classList.remove('on');
      return;
    }
    const e = entropyBlocks(b, ENTROPY_BLOCKS);
    const total = b.byteLength;
    const bars = [];
    for (let i = 0; i < ENTROPY_BLOCKS; i++) {
      const ratio = Math.max(0, Math.min(1, e[i] / 8));
      const start = blockOffset(i, total, ENTROPY_BLOCKS);
      const endNext = blockOffset(i + 1, total, ENTROPY_BLOCKS);
      const blockLen = Math.max(1, endNext - start);
      const btn = el('button', {
        class: 'hex-entropy-bar',
        type: 'button',
        title: `block ${i} \u00B7 offset 0x${start.toString(16).toUpperCase()} \u00B7 entropy ${e[i].toFixed(1)} bits`,
        dataset: { block: String(i), offset: String(start), len: String(blockLen) }
      });
      const fill = el('span', { class: 'hex-entropy-fill' });
      fill.style.height = `${(ratio * 100).toFixed(1)}%`;
      btn.appendChild(fill);
      bars.push(btn);
    }
    replaceChildren(entropyBars, bars);
    entropyStrip.classList.add('on');
  }

  function updateMarker() {
    const b = bytes();
    if (b.byteLength === 0) {
      entropyMarker.style.opacity = '0';
      return;
    }
    // scrollTop is physical; convert via scale to virtual top, then to bytes.
    const virtualY = scrollTop * (geom.scale || 1);
    const firstByte = Math.floor(virtualY / ROW_HEIGHT) * BYTES_PER_ROW;
    const ratio = Math.max(0, Math.min(1, firstByte / Math.max(1, b.byteLength)));
    entropyMarker.style.opacity = '1';
    entropyMarker.style.left = `${(ratio * 100).toFixed(2)}%`;
  }

  entropyBars.addEventListener('click', (e) => {
    const t = e.target.closest('.hex-entropy-bar');
    if (!t) return;
    const offset = Number(t.dataset.offset);
    const len = Number(t.dataset.len);
    jumpToOffset(offset, len);
  });

  // ─── Jump + flash ──────────────────────────────
  function jumpToOffset(offset, len = 1, flash = true) {
    const b = bytes();
    if (!b.byteLength) return;
    const clamped = Math.max(0, Math.min(offset, b.byteLength - 1));
    const targetRow = Math.floor(clamped / BYTES_PER_ROW);
    const thirdOffset = Math.max(0, Math.floor(viewportHeight / 3));
    const virtualTargetTop = targetRow * ROW_HEIGHT;
    const top = Math.max(0, (virtualTargetTop - thirdOffset) / (geom.scale || 1));
    try {
      scroll.scrollTo({ top, behavior: 'smooth' });
    } catch (_) {
      scroll.scrollTop = top;
    }
    if (flash) {
      pendingFlash = { offset: clamped, len };
      requestAnimationFrame(() => {
        requestAnimationFrame(() => doFlash());
      });
    }
  }

  function doFlash() {
    if (!pendingFlash) return;
    const { offset, len } = pendingFlash;
    pendingFlash = null;
    const startRow = Math.floor(offset / BYTES_PER_ROW);
    const endRow = Math.floor((offset + Math.max(1, len) - 1) / BYTES_PER_ROW);
    rowPool.forEach(node => {
      const r = Number(node.dataset.row);
      if (r >= startRow && r <= endRow) {
        node.classList.remove('flash');
        void node.offsetWidth;
        node.classList.add('flash');
        setTimeout(() => node.classList.remove('flash'), 480);
      }
    });
    const endByte = offset + Math.max(1, len);
    const cells = sizer.querySelectorAll('[data-fi]');
    cells.forEach(cell => {
      const fi = Number(cell.dataset.fi);
      if (fi >= offset && fi < endByte) {
        cell.classList.remove('flash');
        void cell.offsetWidth;
        cell.classList.add('flash');
        setTimeout(() => cell.classList.remove('flash'), 480);
      }
    });
  }

  wrap.flashRange = jumpToOffset;

  // Hover delegation — paint the overlay range under the cursor + tip popup.
  scroll.addEventListener('mouseover', (e) => {
    const t = e.target.closest('.ovr');
    if (!t) return;
    const fi = Number(t.dataset.fi);
    const f = findOverlayAt(overlays(), fi);
    if (f && f !== hoveredField) {
      hoveredField = f;
      paintHotCells();
      renderTip();
    }
  });
  scroll.addEventListener('mouseleave', () => {
    hoveredField = null;
    paintHotCells();
    renderTip();
  });

  // Click-to-select a byte. Pushes details to the status bar.
  scroll.addEventListener('click', (e) => {
    const t = e.target.closest('[data-fi]');
    if (!t) return;
    selectedOffset = Number(t.dataset.fi);
    paintHotCells();
    pushSelectionHint();
  });

  // PgUp/PgDn/Arrow/Home/End — the capped scrollbar can be coarse on multi-
  // MiB files (one px ~= 10 bytes on a 16 MiB cart at 2M physical), so
  // keyboard nav recovers row-precision.
  scroll.tabIndex = 0;
  scroll.addEventListener('keydown', (e) => {
    const b = bytes();
    if (!b.byteLength) return;
    const page = Math.max(1, Math.floor(viewportHeight / ROW_HEIGHT) - 2);
    const stepRow = (rows) => {
      const virtualY = scrollTop * (geom.scale || 1);
      const newVirtualY = Math.max(0, virtualY + rows * ROW_HEIGHT);
      scroll.scrollTop = newVirtualY / (geom.scale || 1);
    };
    if (e.key === 'PageDown') { e.preventDefault(); stepRow(page); }
    else if (e.key === 'PageUp') { e.preventDefault(); stepRow(-page); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); stepRow(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); stepRow(-1); }
    else if (e.key === 'Home') { e.preventDefault(); scroll.scrollTop = 0; }
    else if (e.key === 'End') {
      e.preventDefault();
      scroll.scrollTop = geom.physicalPx;
    }
  });

  let scrollRaf = 0;
  scroll.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      scrollTop = scroll.scrollTop;
      render();
    });
  }, { passive: true });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = input.value.trim();
    if (!raw) return;
    const n = parseInt(raw.replace(/^0x/i, ''), 16);
    if (Number.isNaN(n) || n < 0 || n >= bytes().byteLength) return;
    jumpToOffset(n, 1);
  });

  const ro = new ResizeObserver(() => {
    viewportHeight = scroll.clientHeight;
    render();
  });
  ro.observe(scroll);

  const hexFileSub = () => {
    scroll.scrollTop = 0;
    scrollTop = 0;
    hoveredField = null;
    selectedOffset = -1;
    pendingFlash = null;
    clearHint('hex');
    buildEntropy();
    render();
    renderTip();
  };
  hexFileSub.__dbg = 'hex.fileSub';
  fileStore.subscribe(hexFileSub);

  navStore.subscribe((req) => {
    if (!req || req.route !== 'hex') return;
    const len = typeof req.len === 'number' ? req.len : 1;
    jumpToOffset(req.address, len);
  });

  let lastFollowRow = -1;
  gamePcStore.subscribe((pc) => {
    if (!pc?.follow) { lastFollowRow = -1; return; }
    if (!pc.inCart || typeof pc.offset !== 'number') return;
    const row = Math.floor(pc.offset / BYTES_PER_ROW);
    if (row === lastFollowRow) return;
    lastFollowRow = row;
    jumpToOffset(pc.offset, pc.mode === 'THUMB' ? 2 : 4, false);
  });

  return wrap;
}
