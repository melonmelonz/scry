import { Store } from '../store.js';

// Current loaded file. name + bytes (Uint8Array). bytes === null means no file.
export const fileStore = new Store({ name: null, bytes: null });

export function loadFile(name, bytes) {
  fileStore.set({ name, bytes });
}

export function clearFile() {
  fileStore.set({ name: null, bytes: null });
}

export function fileSize() {
  const b = fileStore.get().bytes;
  return b ? b.byteLength : 0;
}
