import { router } from '../stores/router.js';
import { fileStore } from '../stores/file.js';
import { detectFormat } from '../format/detect.js';

function hasFile() {
  return fileStore.get().bytes !== null;
}

function isELF() {
  const b = fileStore.get().bytes;
  return b !== null && detectFormat(b) === 'elf';
}

// Phase 1 (v1) — each tab decides its own availability via the `enabled` fn.
const TABS = [
  { id: 'inspect', label: 'INSPECT', enabled: () => isELF() },
  { id: 'hex',     label: 'HEX',     enabled: () => hasFile() },
  { id: 'disasm',  label: 'DISASM',  enabled: () => hasFile() },
  { id: 'emu',     label: 'EMU',     enabled: () => hasFile() },
  { id: 'trace',   label: 'TRACE',   enabled: () => hasFile() }
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
    for (const t of TABS) {
      const btn = buttons.get(t.id);
      btn.classList.toggle('on', route === t.id);
      btn.disabled = !t.enabled();
    }
  }

  router.subscribe(refresh);
  fileStore.subscribe(refresh);
  return el;
}
