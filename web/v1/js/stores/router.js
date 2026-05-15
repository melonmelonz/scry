import { Store } from '../store.js';

// The router has no hardcoded route list anymore. Routes used to live in a
// `VALID_ROUTES` constant here that had to be hand-kept-in-sync with the
// `factories` table in main.js — and inevitably drifted (2026-05-14: missing
// 'game'/'wave' silently rejected every GBA/WAV file). main.js now seeds
// allowed routes from its own factory keys at startup via setValid(); the
// router is just a hash<->store shuttle.

class Router {
  #store = new Store({ route: 'empty' });
  #valid = new Set(['empty']); // empty is always valid (initial state).

  constructor() {
    if (typeof window !== 'undefined') {
      this.sync();
      window.addEventListener('hashchange', () => this.sync());
    }
  }

  get route() { return this.#store.get().route; }

  setValid(routes) {
    this.#valid = new Set(['empty', ...routes]);
    // Re-resolve the current hash against the new set so a route that wasn't
    // valid at construction time (everything but 'empty') gets accepted now.
    if (typeof window !== 'undefined') this.sync();
  }

  #parse(hash) {
    const slug = (hash || '').replace(/^#\/?/, '');
    return this.#valid.has(slug) ? slug : 'empty';
  }

  sync() {
    const r = this.#parse(window.location.hash);
    // Skip the redundant set when we're already on this route. Store
    // compares by reference so a fresh {route:'game'} object always looks
    // "new"; without this filter, every hashchange right after a direct
    // go() would re-notify every subscriber.
    if (this.#store.get().route === r) return;
    console.log('[scry/route] sync hash=%o → %o', window.location.hash, r);
    this.#store.set({ route: r });
  }

  go(route) {
    if (!this.#valid.has(route)) {
      console.log('[scry/route] go REJECTED route=%o (not in valid set)', route);
      return;
    }
    if (this.#store.get().route === route) return;
    console.log('[scry/route] go(%o)', route);
    window.location.hash = `#/${route}`;
    this.#store.set({ route });
  }

  subscribe(fn) {
    return this.#store.subscribe(s => fn(s.route));
  }
}

export const router = new Router();
