import { Store } from '../store.js';

// Cross-module navigation requests. A module (e.g. inspect) can ask the
// router to switch to another route and have that route scroll to an address.
// Shape: { route: 'disasm'|'hex', address: number, ts: number }
// `ts` distinguishes consecutive requests for the same address — a subscriber
// that scrolls only on change will still see repeats.
export const navStore = new Store(null);

export function gotoIn(route, address) {
  navStore.set({ route, address: address >>> 0, ts: Date.now() });
}
