import { fileStore } from '../stores/file.js';
import { detectFormat } from '../format/detect.js';
import { visibleRange } from '../hex/virtualize.js';
import { pickOverlay, findOverlayAt, decodeField, formatDecoded } from '../hex/overlays.js';
import { entropyBlocks, blockOffset } from '../hex/entropy.js';
import { el, replaceChildren } from '../dom.js';
import { setHint, clearHint } from '../stores/hint.js';
import { navStore } from '../stores/nav.js';
import { router } from '../stores/router.js';

const ROW_HEIGHT = 20;
const BYTES_PER_ROW = 16;
const OVERSCAN = 6;
const ENTROPY_BLOCKS = 64;

function hex2(n) { return n.toString(16).padStart(2, '0').toUpperCase(); }
function hex8(n) { return '0x' + (n >>> 0).toString(16).padStart(8, '0').toUpperCase(); }
function asciiCh(n) { return (n >= 0x20 && n <= 0x7E) ? String.fromCharCode(n) : '.'; }

// Build the DOM for a single 16-byte row. Cells get data-fi (file offset) so
// the parent can use event delegation for hover.
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

  const row = el('div', { class: 'hex-row' }, [addr, bytesSpan, asciiSpan]);
  return row;
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

  // Entropy strip — 64 bars + a position marker. Built once; bar heights and
  // marker position are mutated in place.
  const entropyBars = el('div', { class: 'hex-entropy-bars' });
  const entropyMarker = el('div', { class: 'hex-entropy-marker' });
  const entropyStrip = el('div', { class: 'hex-entropy' }, [entropyBars, entropyMarker]);

  const scroll = el('div', { class: 'hex-scroll' });
  const tipHost = el('div', { class: 'tip-host' });
  const wrap = el('section', { class: 'hex-wrap' }, [bar, entropyStrip, scroll, tipHost]);

  const topSpacer = document.createElement('div');
  const bottomSpacer = document.createElement('div');
  scroll.appendChild(topSpacer);
  scroll.appendChild(bottomSpacer);

  let scrollTop = 0;
  let viewportHeight = 400;
  let rowPool = [];
  let hoveredField = null;
  let selectedOffset = -1;
  let lastEntropy = null;
  // Pending jump (set by external nav, applied once scroll viewport is sized
  // and bytes are present). { offset, len } | null.
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
      rowPool.push(document.createElement('div'));
    }
  }

  function render() {
    const b = bytes();
    const ov = overlays();
    titleEl.textContent = `HEX \u00B7 ${b.byteLength.toLocaleString()} bytes`;

    const range = visibleRange({
      scrollTop, viewportHeight,
      rowHeight: ROW_HEIGHT, totalRows: totalRows(), overscan: OVERSCAN
    });

    topSpacer.style.height = `${range.topPad}px`;
    bottomSpacer.style.height = `${range.bottomPad}px`;

    const count = range.end - range.start;
    ensureRowPool(count);

    // Detach old beyond count.
    for (let i = count; i < rowPool.length; i++) {
      if (rowPool[i].parentNode) rowPool[i].remove();
    }

    for (let i = 0; i < count; i++) {
      const rowIdx = range.start + i;
      const startByte = rowIdx * BYTES_PER_ROW;
      const endByte = Math.min(startByte + BYTES_PER_ROW, b.byteLength);
      const slice = b.subarray(startByte, endByte);
      const built = buildRow(rowIdx * BYTES_PER_ROW, rowIdx * BYTES_PER_ROW, slice, ov);
      // Replace the pooled row's contents. Preserve any in-flight .flash class
      // so an active flash on this pooled DOM node doesn't get nuked mid-fade
      // — flashRange always retags by row index before each animation step.
      rowPool[i].className = 'hex-row';
      rowPool[i].dataset.row = String(rowIdx);
      replaceChildren(rowPool[i], Array.from(built.childNodes));
      if (rowPool[i].parentNode !== scroll) {
        scroll.insertBefore(rowPool[i], bottomSpacer);
      }
    }
    paintHotCells();
    updateMarker();
  }

  function paintHotCells() {
    const all = scroll.querySelectorAll('.ovr');
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
    // Selection paint runs over every visible cell, not just .ovr.
    const cells = scroll.querySelectorAll('[data-fi]');
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
      lastEntropy = null;
      replaceChildren(entropyBars, []);
      entropyStrip.classList.remove('on');
      return;
    }
    const e = entropyBlocks(b, ENTROPY_BLOCKS);
    lastEntropy = e;
    const total = b.byteLength;
    const bars = [];
    for (let i = 0; i < ENTROPY_BLOCKS; i++) {
      const ratio = Math.max(0, Math.min(1, e[i] / 8));
      const start = blockOffset(i, total, ENTROPY_BLOCKS);
      const endNext = blockOffset(i + 1, total, ENTROPY_BLOCKS);
      const blockLen = Math.max(1, endNext - start);
      const bar = el('button', {
        class: 'hex-entropy-bar',
        type: 'button',
        title: `block ${i} \u00B7 offset 0x${start.toString(16).toUpperCase()} \u00B7 entropy ${e[i].toFixed(1)} bits`,
        dataset: { block: String(i), offset: String(start), len: String(blockLen) }
      });
      // Inner fill controls height so the click target remains a full-height
      // 36px column even where entropy is near zero.
      const fill = el('span', { class: 'hex-entropy-fill' });
      fill.style.height = `${(ratio * 100).toFixed(1)}%`;
      bar.appendChild(fill);
      bars.push(bar);
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
    const firstByte = Math.floor(scrollTop / ROW_HEIGHT) * BYTES_PER_ROW;
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
  // Scroll the offset to roughly the top third of the viewport, then paint a
  // fade flash on the affected rows and individual byte cells.
  function jumpToOffset(offset, len = 1) {
    const b = bytes();
    if (!b.byteLength) return;
    const clamped = Math.max(0, Math.min(offset, b.byteLength - 1));
    const targetRow = Math.floor(clamped / BYTES_PER_ROW);
    // Top-third placement keeps the destination visually anchored without
    // bumping it flush against the entropy strip.
    const thirdOffset = Math.max(0, Math.floor(viewportHeight / 3));
    const top = Math.max(0, targetRow * ROW_HEIGHT - thirdOffset);
    try {
      scroll.scrollTo({ top, behavior: 'smooth' });
    } catch (_) {
      scroll.scrollTop = top;
    }
    // Defer the flash a frame so the virtualizer has a chance to render the
    // destination rows after scroll lands.
    pendingFlash = { offset: clamped, len };
    requestAnimationFrame(() => {
      // Wait one more frame so the smooth-scroll's first paint has settled
      // and any newly-mounted rows exist in the DOM.
      requestAnimationFrame(() => doFlash());
    });
  }

  function doFlash() {
    if (!pendingFlash) return;
    const { offset, len } = pendingFlash;
    pendingFlash = null;
    const startRow = Math.floor(offset / BYTES_PER_ROW);
    const endRow = Math.floor((offset + Math.max(1, len) - 1) / BYTES_PER_ROW);
    // Row-level flash.
    rowPool.forEach(node => {
      const r = Number(node.dataset.row);
      if (r >= startRow && r <= endRow) {
        node.classList.remove('flash');
        // Force a reflow so re-adding the class restarts the transition.
        void node.offsetWidth;
        node.classList.add('flash');
        // Clean up the class once the fade finishes so re-pooled rows don't
        // inherit a stale animation state.
        setTimeout(() => node.classList.remove('flash'), 480);
      }
    });
    // Cell-level flash for the precise byte range.
    const endByte = offset + Math.max(1, len);
    const cells = scroll.querySelectorAll('[data-fi]');
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

  // Expose for cross-pane choreography. Callers like INSPECT may invoke this
  // directly after a router.go('hex').
  wrap.flashRange = jumpToOffset;

  // Hover delegation.
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

  scroll.addEventListener('scroll', () => {
    scrollTop = scroll.scrollTop;
    render();
  });

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

  // File subscribe first: the Store impl fires synchronously on subscribe,
  // so this seeds the entropy strip + initial render before any nav request
  // could land below.
  const hexFileSub = () => {
    scroll.scrollTop = 0;
    scrollTop = 0;
    hoveredField = null;
    selectedOffset = -1;
    pendingFlash = null;
    clearHint('hex');
    console.time('[scry/dbg] hex.buildEntropy');
    buildEntropy();
    console.timeEnd('[scry/dbg] hex.buildEntropy');
    console.time('[scry/dbg] hex.render');
    render();
    console.timeEnd('[scry/dbg] hex.render');
    renderTip();
  };
  hexFileSub.__dbg = 'hex.fileSub';
  fileStore.subscribe(hexFileSub);

  // Cross-module navigation: respond to navStore requests targeting 'hex'.
  // INSPECT publishes { route: 'hex', address: offset, len, ts } and the
  // router has already switched us in by the time this fires.
  navStore.subscribe((req) => {
    if (!req || req.route !== 'hex') return;
    const len = typeof req.len === 'number' ? req.len : 1;
    jumpToOffset(req.address, len);
  });

  return wrap;
}
