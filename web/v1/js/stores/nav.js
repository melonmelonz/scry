import { Store } from '../store.js';

// Cross-module navigation requests. A module (e.g. inspect) can ask the
// router to switch to another route and have that route scroll to an address.
// Shape: { route: 'disasm'|'hex', address: number, len?: number, ts: number }
// `ts` distinguishes consecutive requests for the same address — a subscriber
// that scrolls only on change will still see repeats.
// `len` is optional. When 'hex' honors a request it flashes that many bytes
// from the address; absent or 0 falls back to a single-byte flash.
export const navStore = new Store(null);

export function gotoIn(route, address, len) {
  navStore.set({
    route,
    address: address >>> 0,
    len: typeof len === 'number' && len > 0 ? len : 1,
    ts: Date.now()
  });
}
