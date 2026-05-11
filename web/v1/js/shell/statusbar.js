import { router } from '../stores/router.js';
import { fileStore } from '../stores/file.js';
import { el, replaceChildren } from '../dom.js';

export function createStatusBar() {
  const host = document.createElement('footer');
  host.className = 's-status';

  function render() {
    const has = fileStore.get().bytes !== null;
    const left = has ? 'READY · LOCAL · NO UPLOAD' : 'AWAITING FILE · LOCAL · NO UPLOAD';
    const dot = el('span', { class: 'dot' });
    const leftSpan = el('span', {}, [dot, left]);
    const rightSpan = el('span', { text: `MODULE · ${router.route.toUpperCase()} · WORKBENCH v0.1` });
    replaceChildren(host, [leftSpan, rightSpan]);
  }

  router.subscribe(render);
  fileStore.subscribe(render);
  return host;
}
