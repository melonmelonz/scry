import { router } from '../stores/router.js';
import { fileStore } from '../stores/file.js';
import { hintStore } from '../stores/hint.js';
import { el, replaceChildren } from '../dom.js';

const BOOT_KEY = 'scry-booted-v1';
const BOOT_MSG = 'scry \u00B7 awaiting binary';
const BOOT_TICK_MS = 60;

export function createStatusBar() {
  const host = document.createElement('footer');
  host.className = 's-status';

  // First-paint boot gating. If sessionStorage isn't available (privacy
  // mode, sandboxed iframe), skip the type-out — fall straight to normal
  // status rendering so we don't leave the bar visually empty.
  let booting = false;
  try {
    if (!sessionStorage.getItem(BOOT_KEY)) booting = true;
  } catch (_) { booting = false; }

  function render() {
    if (booting) return; // boot animation owns the bar until it finishes.
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

  function typeOut() {
    // Reserve the layout with the dot + an empty span so the bar's right
    // side doesn't snap into view mid-type.
    const dot = el('span', { class: 'dot' });
    const left = el('span', { class: 'boot' }, [dot, '']);
    const right = el('span', { text: '' });
    replaceChildren(host, [left, right]);
    const textNode = document.createTextNode('');
    left.appendChild(textNode);

    let i = 0;
    function tick() {
      // If a file landed mid-type, bail out and let the normal renderer
      // pick up — keeps the bar honest about state.
      if (fileStore.get().bytes !== null) {
        finish();
        return;
      }
      if (i >= BOOT_MSG.length) {
        finish();
        return;
      }
      textNode.data += BOOT_MSG.charAt(i);
      i++;
      setTimeout(tick, BOOT_TICK_MS);
    }
    function finish() {
      booting = false;
      try { sessionStorage.setItem(BOOT_KEY, '1'); } catch (_) { /* ignore */ }
      render();
    }
    // Run after first paint so the rest of the UI mounts unblocked.
    requestAnimationFrame(() => requestAnimationFrame(tick));
  }

  router.subscribe(render);
  fileStore.subscribe(render);
  hintStore.subscribe(render);

  if (booting) {
    typeOut();
  } else {
    render();
  }

  return host;
}
