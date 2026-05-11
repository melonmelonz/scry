import { fileStore } from '../stores/file.js';
import { detectFormat } from '../format/detect.js';
import { visibleRange } from '../hex/virtualize.js';
import { pickOverlay, findOverlayAt, decodeField, formatDecoded } from '../hex/overlays.js';
import { el, replaceChildren } from '../dom.js';

const ROW_HEIGHT = 20;
const BYTES_PER_ROW = 16;
const OVERSCAN = 6;

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
  const scroll = el('div', { class: 'hex-scroll' });
  const tipHost = el('div', { class: 'tip-host' });
  const wrap = el('section', { class: 'hex-wrap' }, [bar, scroll, tipHost]);

  const topSpacer = document.createElement('div');
  const bottomSpacer = document.createElement('div');
  scroll.appendChild(topSpacer);
  scroll.appendChild(bottomSpacer);

  let scrollTop = 0;
  let viewportHeight = 400;
  let rowPool = [];
  let hoveredField = null;

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
    titleEl.textContent = `HEX · ${b.byteLength.toLocaleString()} bytes`;

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
      // Replace the pooled row's contents.
      rowPool[i].className = 'hex-row';
      replaceChildren(rowPool[i], Array.from(built.childNodes));
      if (rowPool[i].parentNode !== scroll) {
        scroll.insertBefore(rowPool[i], bottomSpacer);
      }
    }
    paintHotCells();
  }

  function paintHotCells() {
    const all = scroll.querySelectorAll('.ovr');
    if (!hoveredField) {
      all.forEach(n => n.classList.remove('hot'));
      return;
    }
    const start = hoveredField.offset;
    const end = hoveredField.offset + hoveredField.size;
    all.forEach(n => {
      const fi = Number(n.dataset.fi);
      n.classList.toggle('hot', fi >= start && fi < end);
    });
  }

  function renderTip() {
    if (!hoveredField) {
      replaceChildren(tipHost, []);
      return;
    }
    replaceChildren(tipHost, [buildTip(hoveredField, bytes())]);
  }

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
    const row = Math.floor(n / BYTES_PER_ROW);
    scroll.scrollTop = row * ROW_HEIGHT;
  });

  const ro = new ResizeObserver(() => {
    viewportHeight = scroll.clientHeight;
    render();
  });
  ro.observe(scroll);

  fileStore.subscribe(() => {
    scroll.scrollTop = 0;
    scrollTop = 0;
    hoveredField = null;
    render();
    renderTip();
  });

  return wrap;
}
