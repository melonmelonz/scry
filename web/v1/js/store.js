// Tiny reactive store. No framework, just pub/sub.
// Usage:
//   const s = new Store({ count: 0 });
//   const off = s.subscribe(state => console.log(state));
//   s.update({ count: 1 });
//   off();

export class Store {
  #value;
  #subs = new Set();

  constructor(initial) {
    this.#value = initial;
  }

  get() {
    return this.#value;
  }

  set(value) {
    // Skip notification when the reference hasn't changed. Most callers
    // pass a freshly-spread object so this is a cheap dedupe; it stops
    // router.go(currentRoute) from re-firing every subscriber, and stops
    // the hashchange-then-store-set double-fire inside router.go.
    if (value === this.#value) return;
    this.#value = value;
    this.#notify();
  }

  update(patch) {
    this.#value = { ...this.#value, ...patch };
    this.#notify();
  }

  subscribe(fn) {
    this.#subs.add(fn);
    fn(this.#value);
    return () => this.#subs.delete(fn);
  }

  #notifying = false;

  #notify() {
    // Snapshot the subscriber set before iterating. Without this, a
    // subscriber that triggers a nested store.set (e.g. showRoute ->
    // router.go -> router.store.set -> showRoute -> createGame ->
    // fileStore.subscribe) would add a new subscriber to the Set mid-
    // iteration. JS Set iteration visits newly-added entries, so the
    // new subscriber fires twice: once from subscribe(fn) and once from
    // the outer loop. Firefox surfaces this as a visible double-render;
    // Chrome hides it behind faster paint. Snapshotting prevents it.
    if (this.#notifying) return;
    this.#notifying = true;
    try {
      const snapshot = [...this.#subs];
      let i = 0;
      for (const fn of snapshot) {
        const label = `[scry/dbg] store#${i++} ${fn.__dbg || fn.name || 'anon'}`;
        console.time(label);
        try { fn(this.#value); }
        finally { console.timeEnd(label); }
      }
    } finally {
      this.#notifying = false;
    }
  }
}
