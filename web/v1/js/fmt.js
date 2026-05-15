// Tiny formatting helpers shared across modules. These used to be inlined in
// hex.js, game.js, wave.js, trace.js, and stores/file.js — same five lines
// each time. Centralizing here so a "one-off byte-size fix" lands in one
// place instead of four.

export function hex2(n) {
  return (n >>> 0).toString(16).padStart(2, '0').toUpperCase();
}

export function hex8(n) {
  return '0x' + (n >>> 0).toString(16).padStart(8, '0').toUpperCase();
}

export function asciiCh(n) {
  return (n >= 0x20 && n <= 0x7E) ? String.fromCharCode(n) : '.';
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

// Read a fixed-length printable ASCII string starting at `off`. Stops at the
// first NUL. Non-printable bytes become '.'. Used to pull cart titles, codes,
// section names — anything where the on-disk encoding is "ASCII with
// trailing NULs, hope for the best."
export function readAsciiZ(bytes, off, len) {
  let s = '';
  for (let i = 0; i < len; i++) {
    const b = bytes[off + i];
    if (b === 0) break;
    s += (b >= 0x20 && b <= 0x7E) ? String.fromCharCode(b) : '.';
  }
  return s.trim();
}
