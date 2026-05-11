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

// Phase 1 (v1) — each tab decides its own availability via `enabled` and
// explains its disabled state via `disabledReason` so the user sees a
// tooltip explaining why it's greyed out.
const TABS = [
  {
    id: 'inspect', label: 'INSPECT',
    enabled: () => isELF(),
    disabledReason: () => hasFile() ? 'INSPECT is ELF-only' : 'Load a file first',
  },
  {
    id: 'hex', label: 'HEX',
    enabled: () => hasFile(),
    disabledReason: () => 'Load a file first',
  },
  {
    id: 'disasm', label: 'DISASM',
    enabled: () => hasFile(),
    disabledReason: () => 'Load a file first',
  },
  {
    id: 'emu', label: 'EMU',
    enabled: () => hasFile(),
    disabledReason: () => 'Load a file first',
  },
  {
    id: 'trace', label: 'TRACE',
    enabled: () => hasFile(),
    disabledReason: () => 'Load a file first',
  },
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
      const ok = t.enabled();
      btn.classList.toggle('on', route === t.id);
      btn.disabled = !ok;
      btn.title = ok ? '' : t.disabledReason();
    }
  }

  router.subscribe(refresh);
  fileStore.subscribe(refresh);
  return el;
}
