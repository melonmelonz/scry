import { Store } from '../store.js';

// Current loaded file. name + bytes (Uint8Array). bytes === null means no file.
// `loading` is a transient flag that consumers can show as a spinner / banner
// while a big drag-in is being read + parsed.
export const fileStore = new Store({ name: null, bytes: null, loading: false, status: null });

export function loadFile(name, bytes) {
  fileStore.set({ name, bytes, loading: false, status: null });
}

export function clearFile() {
  fileStore.set({ name: null, bytes: null, loading: false, status: null });
}

export function setLoading(status) {
  const cur = fileStore.get();
  fileStore.set({ ...cur, loading: true, status });
}

export function fileSize() {
  const b = fileStore.get().bytes;
  return b ? b.byteLength : 0;
}

// Read a File / Blob into the store, with a loading state so consumers can
// paint a spinner before the heavy work blocks the main thread.
export async function ingestFile(file) {
  setLoading(`reading ${file.name} (${file.size.toLocaleString()} bytes)\u2026`);
  // Yield once so subscribers can paint the loading state before we block.
  await new Promise(r => requestAnimationFrame(() => r()));
  try {
    const buf = await file.arrayBuffer();
    setLoading(`parsing ${file.name}\u2026`);
    await new Promise(r => requestAnimationFrame(() => r()));
    loadFile(file.name, new Uint8Array(buf));
  } catch (e) {
    fileStore.set({ name: null, bytes: null, loading: false, status: `failed: ${e.message}` });
  }
}
