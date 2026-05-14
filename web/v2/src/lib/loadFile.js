// Shared load pipeline used by both the empty-state Drop component and the
// global drag-drop overlay. Returns null on rejection (size cap, etc).
// Mirrors the validation v1 does in `web/v1/js/empty/zone.js`.

export const MAX_BYTES = 64 * 1024 * 1024;

export function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

// Accepts a single File, returns { name, bytes } or throws with a human
// reason. Callers should `try/catch` and surface `err.message`.
export async function readFile(file) {
  if (!file) throw new Error('no file');
  if (file.size > MAX_BYTES) {
    throw new Error(`file too large (${fmtSize(file.size)} > ${fmtSize(MAX_BYTES)})`);
  }
  const buf = await file.arrayBuffer();
  return { name: file.name, bytes: new Uint8Array(buf) };
}
