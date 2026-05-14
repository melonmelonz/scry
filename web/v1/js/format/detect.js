// Magic-byte format detector.
// Returns one of: 'elf' | 'wav' | 'png' | 'sal' | 'gba' | 'unknown'.

const ELF_MAGIC = [0x7F, 0x45, 0x4C, 0x46];
const ZIP_MAGIC = [0x50, 0x4B, 0x03, 0x04];
const PNG_MAGIC = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WAVE_TAG   = [0x57, 0x41, 0x56, 0x45]; // "WAVE" at offset 8

function startsWith(bytes, magic, off = 0) {
  if (!bytes || bytes.byteLength < off + magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[off + i] !== magic[i]) return false;
  }
  return true;
}

// GBA cartridges are header-only — no leading magic. The fixed byte at
// 0xB2 == 0x96 is what every BIOS / loader checks, so we rely on it too.
// Headers also contain a 4-byte branch instruction at offset 0 and a
// title at 0xA0, but 0xB2 is the canonical sentinel.
function isGbaCart(bytes) {
  return bytes && bytes.byteLength >= 0xC0 && bytes[0xB2] === 0x96;
}

let __dbgDetectCount = 0;
export function detectFormat(bytes) {
  __dbgDetectCount++;
  if (__dbgDetectCount % 10 === 1) console.log('[scry/dbg] detectFormat call #' + __dbgDetectCount);
  if (startsWith(bytes, ELF_MAGIC)) return 'elf';
  if (startsWith(bytes, RIFF_MAGIC) && startsWith(bytes, WAVE_TAG, 8)) return 'wav';
  if (startsWith(bytes, PNG_MAGIC)) return 'png';
  if (startsWith(bytes, ZIP_MAGIC)) return 'sal';
  if (isGbaCart(bytes)) return 'gba';
  return 'unknown';
}

export function formatLabel(kind) {
  if (kind === 'elf') return 'ELF';
  if (kind === 'wav') return 'WAVE audio';
  if (kind === 'png') return 'PNG image';
  if (kind === 'sal') return 'Saleae capture';
  if (kind === 'gba') return 'GBA cartridge';
  return 'raw bytes';
}
