import { Store } from '../store.js';
import { detectFormat } from '../format/detect.js';
import { fmtBytes } from '../fmt.js';

// Current loaded file. Carries `kind` (cached format detection) so the eight
// subscribers that used to each call detectFormat() per file change now just
// read the precomputed string. bytes === null means no file.
export const fileStore = new Store({
  name: null, bytes: null, kind: 'unknown', loading: false, status: null
});

export function loadFile(name, bytes) {
  const kind = bytes ? detectFormat(bytes) : 'unknown';
  console.log('[scry/file] loadFile name=%o len=%o kind=%o', name, bytes?.byteLength, kind);
  fileStore.set({ name, bytes, kind, loading: false, status: null });
}

export function clearFile() {
  fileStore.set({ name: null, bytes: null, kind: 'unknown', loading: false, status: null });
}

export function setLoading(status) {
  const cur = fileStore.get();
  fileStore.set({ ...cur, loading: true, status });
}

export function fileSize() {
  const b = fileStore.get().bytes;
  return b ? b.byteLength : 0;
}

// Hard cap on dropped files. Anything bigger than this is almost certainly
// not what a person wanted to inspect by hand, and trying to ArrayBuffer it
// will lock the main thread and probably OOM.
export const MAX_FILE_BYTES = 64 * 1024 * 1024; // 64 MiB

// In-flight guard: an ingest can take seconds on a 16 MiB cart (arrayBuffer
// alloc, then a setLoading→loadFile chain that fires every fileStore sub).
// If two listeners both call ingestFile on the same event (drop bubble +
// window listener), we don't want two parallel ingest chains writing the
// same bytes to the store six times.
let ingesting = false;

// Read a File / Blob into the store, with a loading state so consumers can
// paint a spinner before the heavy work blocks the main thread.
export async function ingestFile(file) {
  if (ingesting) {
    console.warn('[scry/file] ingest already in flight, ignoring', file.name);
    return;
  }
  ingesting = true;
  try { return await ingestInner(file); }
  finally { ingesting = false; }
}

async function ingestInner(file) {
  if (file.size > MAX_FILE_BYTES) {
    fileStore.set({
      name: null, bytes: null, kind: 'unknown', loading: false,
      status: `refused: ${fmtBytes(file.size)} exceeds ${fmtBytes(MAX_FILE_BYTES)} cap`
    });
    return;
  }
  setLoading(`reading ${file.name} (${fmtBytes(file.size)})\u2026`);
  // Yield once so subscribers can paint the loading state before we block.
  await new Promise(r => requestAnimationFrame(() => r()));
  try {
    const buf = await file.arrayBuffer();
    setLoading(`parsing ${file.name}\u2026`);
    await new Promise(r => requestAnimationFrame(() => r()));
    loadFile(file.name, new Uint8Array(buf));
  } catch (e) {
    fileStore.set({
      name: null, bytes: null, kind: 'unknown', loading: false,
      status: `failed: ${e.message}`
    });
  }
}
