import { fileStore, clearFile } from '../stores/file.js';
import { el, replaceChildren } from '../dom.js';
import { createThemeToggle } from './theme.js';
import { fmtBytes } from '../fmt.js';

export function createHeader() {
  const host = document.createElement('header');
  host.className = 's-header';
  // Toggle lives outside the file-store re-render so its click listener
  // isn't torn down whenever a new file is loaded.
  const themeBtn = createThemeToggle();

  function render(state) {
    const has = state.bytes !== null;
    // Brand doubles as "back to import" when a file is loaded. Visible
    // affordance: the cursor and hover style change when there's somewhere
    // to go. The text and dot stay the same so the chrome doesn't shift.
    const brand = el('span', {
      class: has ? 's-brand s-brand-clickable' : 's-brand',
      text: 'scry',
      title: has ? 'Clear file \u00B7 back to import' : '',
      onclick: has ? () => clearFile() : null,
    });

    let meta;
    if (has) {
      const close = el('button', {
        class: 's-close',
        text: 'CLOSE',
        title: 'Clear file \u00B7 back to import',
        onclick: () => clearFile(),
      });
      meta = el('span', { class: 's-meta' }, [
        el('span', {}, ['FILE', el('span', { class: 'v', text: state.name })]),
        el('span', {}, ['SIZE', el('span', { class: 'v', text: fmtBytes(state.bytes.byteLength) })]),
        close
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
