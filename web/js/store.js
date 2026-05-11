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

  #notify() {
    for (const fn of this.#subs) fn(this.#value);
  }
}
