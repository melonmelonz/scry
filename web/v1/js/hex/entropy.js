// Shannon entropy over fixed-count equal-width blocks across a Uint8Array.
// Returns a Float32Array of length `blocks` (default 64). Each value is in
// [0, 8] — bits per byte. Empty / null input returns a zeroed array.

const LN2 = Math.log(2);

export function entropyBlocks(bytes, blocks = 64) {
  const out = new Float32Array(blocks);
  if (!bytes || bytes.byteLength === 0) return out;
  const total = bytes.byteLength;
  // Histogram reused per block to avoid 64 allocations.
  const hist = new Uint32Array(256);
  for (let b = 0; b < blocks; b++) {
    const start = Math.floor((b * total) / blocks);
    const end = Math.floor(((b + 1) * total) / blocks);
    const n = end - start;
    if (n <= 0) { out[b] = 0; continue; }
    hist.fill(0);
    for (let i = start; i < end; i++) hist[bytes[i]]++;
    let h = 0;
    for (let v = 0; v < 256; v++) {
      const c = hist[v];
      if (c === 0) continue;
      const p = c / n;
      h -= p * (Math.log(p) / LN2);
    }
    out[b] = h;
  }
  return out;
}

// Mean entropy across the whole buffer (single block). For huge buffers
// we sample a strided subset so the rail's auto-summary doesn't block the
// main thread for hundreds of ms when a 16 MiB cart lands. The estimate
// stays well within 0.05 bits of the true mean for any binary we've
// tested at >=64 KiB sample size.
const ENTROPY_SAMPLE_CAP = 256 * 1024;

export function entropyMean(bytes) {
  if (!bytes || bytes.byteLength === 0) return 0;
  if (bytes.byteLength <= ENTROPY_SAMPLE_CAP) {
    return entropyBlocks(bytes, 1)[0];
  }
  const total = bytes.byteLength;
  const stride = Math.ceil(total / ENTROPY_SAMPLE_CAP);
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < total; i += stride) { hist[bytes[i]]++; n++; }
  if (!n) return 0;
  let h = 0;
  for (let v = 0; v < 256; v++) {
    const c = hist[v];
    if (!c) continue;
    const p = c / n;
    h -= p * (Math.log(p) / LN2);
  }
  return h;
}

// Compute the byte offset at which block `i` starts, given total length and
// block count. Same math as entropyBlocks() so click-to-jump lands on the
// same byte range we measured.
export function blockOffset(i, total, blocks = 64) {
  return Math.floor((i * total) / blocks);
}
