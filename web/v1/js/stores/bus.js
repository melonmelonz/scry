// Shared bus event log. The emulator pushes MMIO transactions here; the
// Trace module subscribes and decodes them as SPI/I²C transactions.
import { Store } from '../store.js';

class BusLog {
  #store = new Store({ events: [], version: 0 });

  get events() {
    return this.#store.get().events;
  }

  push(event) {
    const s = this.#store.get();
    s.events.push(event);
    // Cap event history to keep memory bounded.
    if (s.events.length > 50000) s.events.shift();
    this.#store.set({ events: s.events, version: s.version + 1 });
  }

  clear() {
    this.#store.set({ events: [], version: 0 });
  }

  subscribe(fn) {
    return this.#store.subscribe(fn);
  }
}

export const busLog = new BusLog();
