import { fileStore } from '../stores/file.js';
import { el, replaceChildren } from '../dom.js';
import { createThemeToggle } from './theme.js';

function sizeFmt(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

export function createHeader() {
  const host = document.createElement('header');
  host.className = 's-header';
  // Toggle lives outside the file-store re-render so its click listener
  // isn't torn down whenever a new file is loaded.
  const themeBtn = createThemeToggle();

  function render(state) {
    const has = state.bytes !== null;
    const brand = el('span', { class: 's-brand', text: 'scry' });

    let meta;
    if (has) {
      meta = el('span', { class: 's-meta' }, [
        el('span', {}, ['FILE', el('span', { class: 'v', text: state.name })]),
        el('span', {}, ['SIZE', el('span', { class: 'v', text: sizeFmt(state.bytes.byteLength) })])
      ]);
    } else {
      meta = el('span', { class: 's-meta' }, [
        el('span', { text: 'WORKBENCH \u00B7 v0.1' })
      ]);
    }
    const right = el('span', { class: 's-right' }, [meta, themeBtn]);
    replaceChildren(host, [brand, right]);
  }

  fileStore.subscribe(render);
  return host;
}
