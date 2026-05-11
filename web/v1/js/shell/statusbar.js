import { router } from '../stores/router.js';
import { fileStore } from '../stores/file.js';
import { hintStore } from '../stores/hint.js';
import { el, replaceChildren } from '../dom.js';

export function createStatusBar() {
  const host = document.createElement('footer');
  host.className = 's-status';

  function render() {
    const has = fileStore.get().bytes !== null;
    const dot = el('span', { class: 'dot' });
    const leftText = has ? 'READY \u00B7 LOCAL \u00B7 NO UPLOAD' : 'AWAITING FILE \u00B7 LOCAL \u00B7 NO UPLOAD';
    const leftSpan = el('span', {}, [dot, leftText]);

    const hint = hintStore.get();
    const hintText = (hint && hint.route === router.route && hint.text) ? hint.text : null;
    const moduleLabel = `MODULE \u00B7 ${router.route.toUpperCase()}`;
    const rightSpan = hintText
      ? el('span', { class: 's-status-right' }, [
          el('span', { class: 'hint', text: hintText }),
          el('span', { class: 'sep', text: ' \u00B7 ' }),
          el('span', { text: moduleLabel })
        ])
      : el('span', { text: `${moduleLabel} \u00B7 WORKBENCH v0.1` });

    replaceChildren(host, [leftSpan, rightSpan]);
  }

  router.subscribe(render);
  fileStore.subscribe(render);
  hintStore.subscribe(render);
  return host;
}
