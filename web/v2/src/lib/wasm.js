// Lazy init wrapper around the wasm-pack output. Resolves once and caches.
import init, * as core from '../wasm/scry_core.js';

let _ready = null;
export function ensureWasm() {
  if (!_ready) _ready = init();
  return _ready.then(() => core);
}
