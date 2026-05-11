import { Store } from '../store.js';

// Status-bar hint slot. Each module can push a one-line summary of what the
// user is looking at (selected byte, cycle count, transaction count, etc.)
// and the status bar surfaces it. Modules should publish on render and
// clear (set to null) on unmount.
//
// Shape: { route: 'hex'|'disasm'|..., text: 'OFFSET 0x100 \u00B7 BYTE 0x7F (127)' }
export const hintStore = new Store(null);

export function setHint(route, text) {
  hintStore.set({ route, text });
}

export function clearHint(route) {
  const cur = hintStore.get();
  if (!cur || cur.route === route) hintStore.set(null);
}
