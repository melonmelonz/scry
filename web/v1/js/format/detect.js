// Magic-byte format detector.
// Returns one of: 'elf' | 'sal' | 'unknown'.

const ELF_MAGIC = [0x7F, 0x45, 0x4C, 0x46];
const ZIP_MAGIC = [0x50, 0x4B, 0x03, 0x04];

function startsWith(bytes, magic) {
  if (!bytes || bytes.byteLength < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

export function detectFormat(bytes) {
  if (startsWith(bytes, ELF_MAGIC)) return 'elf';
  if (startsWith(bytes, ZIP_MAGIC)) return 'sal';
  return 'unknown';
}

export function formatLabel(kind) {
  if (kind === 'elf') return 'ELF';
  if (kind === 'sal') return 'Saleae capture';
  return 'raw bytes';
}
