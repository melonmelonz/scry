// Struct overlay schema. A schema is an ordered list of fields; each field is
// { offset, size, name, type, endian?, description? }.
// type: 'u8' | 'u16' | 'u32' | 'bytes' | 'string'
// endian: 'le' | 'be' (defaults to 'le' for numeric types)

export const ELF32_HEADER_OVERLAY = [
  { offset: 0x00, size: 4, name: 'e_ident.magic',      type: 'u32', endian: 'be', description: 'ELF magic (0x7F "ELF")' },
  { offset: 0x04, size: 1, name: 'e_ident.class',      type: 'u8',                 description: '1 = 32-bit, 2 = 64-bit' },
  { offset: 0x05, size: 1, name: 'e_ident.data',       type: 'u8',                 description: '1 = little-endian, 2 = big-endian' },
  { offset: 0x06, size: 1, name: 'e_ident.version',    type: 'u8' },
  { offset: 0x07, size: 1, name: 'e_ident.osabi',      type: 'u8' },
  { offset: 0x08, size: 1, name: 'e_ident.abiversion', type: 'u8' },
  { offset: 0x09, size: 7, name: 'e_ident.pad',        type: 'bytes' },
  { offset: 0x10, size: 2, name: 'e_type',             type: 'u16', endian: 'le', description: '2 = EXEC, 3 = DYN' },
  { offset: 0x12, size: 2, name: 'e_machine',          type: 'u16', endian: 'le', description: '243 = RISC-V, 62 = x86_64' },
  { offset: 0x14, size: 4, name: 'e_version',          type: 'u32', endian: 'le' },
  { offset: 0x18, size: 4, name: 'e_entry',            type: 'u32', endian: 'le', description: 'Entry-point virtual address' },
  { offset: 0x1C, size: 4, name: 'e_phoff',            type: 'u32', endian: 'le' },
  { offset: 0x20, size: 4, name: 'e_shoff',            type: 'u32', endian: 'le' },
  { offset: 0x24, size: 4, name: 'e_flags',            type: 'u32', endian: 'le' },
  { offset: 0x28, size: 2, name: 'e_ehsize',           type: 'u16', endian: 'le' },
  { offset: 0x2A, size: 2, name: 'e_phentsize',        type: 'u16', endian: 'le' },
  { offset: 0x2C, size: 2, name: 'e_phnum',            type: 'u16', endian: 'le' },
  { offset: 0x2E, size: 2, name: 'e_shentsize',        type: 'u16', endian: 'le' },
  { offset: 0x30, size: 2, name: 'e_shnum',            type: 'u16', endian: 'le' },
  { offset: 0x32, size: 2, name: 'e_shstrndx',         type: 'u16', endian: 'le' }
];

export function findOverlayAt(schema, offset) {
  for (const f of schema) {
    if (offset >= f.offset && offset < f.offset + f.size) return f;
  }
  return null;
}

function offsetOOB(bytes, f) {
  return f.offset + f.size > bytes.byteLength;
}

function readU16(b, o, e) {
  return e === 'le' ? (b[o] | (b[o + 1] << 8)) : ((b[o] << 8) | b[o + 1]);
}

function readU32(b, o, e) {
  return e === 'le'
    ? ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0)
    : (((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
}

export function decodeField(bytes, f) {
  if (offsetOOB(bytes, f)) return NaN;
  if (f.type === 'u8')  return bytes[f.offset];
  if (f.type === 'u16') return readU16(bytes, f.offset, f.endian ?? 'le');
  if (f.type === 'u32') return readU32(bytes, f.offset, f.endian ?? 'le');
  if (f.type === 'string') {
    return new TextDecoder().decode(bytes.subarray(f.offset, f.offset + f.size));
  }
  // 'bytes'
  return Array.from(bytes.subarray(f.offset, f.offset + f.size))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ');
}

export function formatDecoded(v, f) {
  if (typeof v === 'string') return v;
  if (Number.isNaN(v)) return '—';
  if (f.type === 'u32') return '0x' + (v >>> 0).toString(16).padStart(8, '0').toUpperCase() + ` (${v >>> 0})`;
  if (f.type === 'u16') return '0x' + v.toString(16).padStart(4, '0').toUpperCase() + ` (${v})`;
  if (f.type === 'u8')  return '0x' + v.toString(16).padStart(2, '0').toUpperCase() + ` (${v})`;
  return String(v);
}

// Pick the right overlay schema for a detected format. Plan 1 ships ELF only.
export function pickOverlay(formatKind) {
  if (formatKind === 'elf') return ELF32_HEADER_OVERLAY;
  return [];
}
