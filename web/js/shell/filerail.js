import { fileStore } from '../stores/file.js';
import { detectFormat, formatLabel } from '../format/detect.js';
import { el, replaceChildren } from '../dom.js';

function sizeFmt(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}

function railRow(label, value) {
  return el('div', { class: 'row' }, [
    el('span', { class: 'l', text: label }),
    el('span', { class: 'v', text: value })
  ]);
}

export function createFileRail() {
  const host = document.createElement('aside');
  host.className = 's-rail';

  function render(state) {
    if (state.bytes) {
      const kind = detectFormat(state.bytes);
      replaceChildren(host, [
        railRow('File', state.name),
        railRow('Size', sizeFmt(state.bytes.byteLength)),
        railRow('Format', formatLabel(kind))
      ]);
    } else {
      const dot = el('span', { class: 'mint', text: '·' });
      const v = el('span', { class: 'v' }, [dot, ' drop or pick to begin']);
      const row = el('div', { class: 'row' }, [
        el('span', { class: 'l', text: 'No file loaded' }),
        v
      ]);
      replaceChildren(host, [row]);
    }
  }

  fileStore.subscribe(render);
  return host;
}
