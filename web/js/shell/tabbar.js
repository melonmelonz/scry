import { router } from '../stores/router.js';
import { fileStore } from '../stores/file.js';

const TABS = [
  { id: 'inspect', label: 'INSPECT', needsFile: true,  available: false },
  { id: 'hex',     label: 'HEX',     needsFile: true,  available: true  },
  { id: 'disasm',  label: 'DISASM',  needsFile: true,  available: false },
  { id: 'emu',     label: 'EMU',     needsFile: true,  available: false },
  { id: 'trace',   label: 'TRACE',   needsFile: false, available: false }
];

export function createTabBar() {
  const el = document.createElement('nav');
  el.className = 's-tabs';

  const buttons = new Map();
  for (const t of TABS) {
    const btn = document.createElement('button');
    btn.textContent = t.label;
    btn.addEventListener('click', () => router.go(t.id));
    buttons.set(t.id, btn);
    el.appendChild(btn);
  }

  function refresh() {
    const route = router.route;
    const hasFile = fileStore.get().bytes !== null;
    for (const t of TABS) {
      const btn = buttons.get(t.id);
      btn.classList.toggle('on', route === t.id);
      btn.disabled = !t.available || (t.needsFile && !hasFile);
    }
  }

  router.subscribe(refresh);
  fileStore.subscribe(refresh);
  return el;
}
