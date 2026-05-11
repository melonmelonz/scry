import { Store } from '../store.js';

export const VALID_ROUTES = ['empty', 'hex', 'inspect', 'disasm', 'emu', 'trace'];

function parseHash(hash) {
  const slug = (hash || '').replace(/^#\/?/, '');
  return VALID_ROUTES.includes(slug) ? slug : 'empty';
}

class Router {
  #store = new Store({ route: 'empty' });

  constructor() {
    if (typeof window !== 'undefined') {
      this.sync();
      window.addEventListener('hashchange', () => this.sync());
    }
  }

  get route() {
    return this.#store.get().route;
  }

  sync() {
    this.#store.set({ route: parseHash(window.location.hash) });
  }

  go(route) {
    if (!VALID_ROUTES.includes(route)) return;
    window.location.hash = `#/${route}`;
    this.#store.set({ route });
  }

  subscribe(fn) {
    return this.#store.subscribe(s => fn(s.route));
  }
}

export const router = new Router();
