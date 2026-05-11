// Hand-rolled ELF parser. Pure JS. Supports ELF32 and ELF64, little-endian
// and big-endian. Reads file header, section headers, program headers,
// symbol table, and the .shstrtab / .strtab / .dynstr string tables.
//
// References:
//   - System V ABI ELF spec (gen)
//   - https://refspecs.linuxfoundation.org/elf/elf.pdf

const EI_CLASS = 4;
const EI_DATA = 5;

const ELFCLASS32 = 1;
const ELFCLASS64 = 2;

const ELFDATA2LSB = 1;
const ELFDATA2MSB = 2;

export function parseElf(bytes) {
  if (bytes.byteLength < 16) throw new Error('not ELF (too small)');
  if (bytes[0] !== 0x7F || bytes[1] !== 0x45 || bytes[2] !== 0x4C || bytes[3] !== 0x46) {
    throw new Error('not ELF (bad magic)');
  }
  const cls = bytes[EI_CLASS];
  const data = bytes[EI_DATA];
  if (cls !== ELFCLASS32 && cls !== ELFCLASS64) throw new Error('unknown ELF class');
  if (data !== ELFDATA2LSB && data !== ELFDATA2MSB) throw new Error('unknown ELF data encoding');

  const is64 = cls === ELFCLASS64;
  const le = data === ELFDATA2LSB;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  function u16(o) { return dv.getUint16(o, le); }
  function u32(o) { return dv.getUint32(o, le); }
  function u64(o) {
    // ELF offsets and sizes can exceed 2^53 in theory, but in practice no.
    // Read as BigInt then narrow.
    const v = dv.getBigUint64(o, le);
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) {
      // Keep as BigInt — caller handles via toString.
      return v;
    }
    return Number(v);
  }
  function addr(o) { return is64 ? u64(o) : u32(o); }
  function off(o)  { return is64 ? u64(o) : u32(o); }

  // ── File header ──────────────────────────────────────────────────────────
  const header = is64 ? {
    e_ident:     bytes.subarray(0, 16),
    e_type:      u16(0x10),
    e_machine:   u16(0x12),
    e_version:   u32(0x14),
    e_entry:     u64(0x18),
    e_phoff:     u64(0x20),
    e_shoff:     u64(0x28),
    e_flags:     u32(0x30),
    e_ehsize:    u16(0x34),
    e_phentsize: u16(0x36),
    e_phnum:     u16(0x38),
    e_shentsize: u16(0x3A),
    e_shnum:     u16(0x3C),
    e_shstrndx:  u16(0x3E)
  } : {
    e_ident:     bytes.subarray(0, 16),
    e_type:      u16(0x10),
    e_machine:   u16(0x12),
    e_version:   u32(0x14),
    e_entry:     u32(0x18),
    e_phoff:     u32(0x1C),
    e_shoff:     u32(0x20),
    e_flags:     u32(0x24),
    e_ehsize:    u16(0x28),
    e_phentsize: u16(0x2A),
    e_phnum:     u16(0x2C),
    e_shentsize: u16(0x2E),
    e_shnum:     u16(0x30),
    e_shstrndx:  u16(0x32)
  };

  // ── Section header table ────────────────────────────────────────────────
  const sections = [];
  for (let i = 0; i < header.e_shnum; i++) {
    const base = Number(header.e_shoff) + i * header.e_shentsize;
    const sh = is64 ? {
      sh_name:      u32(base + 0x00),
      sh_type:      u32(base + 0x04),
      sh_flags:     u64(base + 0x08),
      sh_addr:      u64(base + 0x10),
      sh_offset:    u64(base + 0x18),
      sh_size:      u64(base + 0x20),
      sh_link:      u32(base + 0x28),
      sh_info:      u32(base + 0x2C),
      sh_addralign: u64(base + 0x30),
      sh_entsize:   u64(base + 0x38)
    } : {
      sh_name:      u32(base + 0x00),
      sh_type:      u32(base + 0x04),
      sh_flags:     u32(base + 0x08),
      sh_addr:      u32(base + 0x0C),
      sh_offset:    u32(base + 0x10),
      sh_size:      u32(base + 0x14),
      sh_link:      u32(base + 0x18),
      sh_info:      u32(base + 0x1C),
      sh_addralign: u32(base + 0x20),
      sh_entsize:   u32(base + 0x24)
    };
    sections.push(sh);
  }

  // ── Section header string table ─────────────────────────────────────────
  let shstr = null;
  if (header.e_shstrndx < sections.length) {
    const s = sections[header.e_shstrndx];
    shstr = bytes.subarray(Number(s.sh_offset), Number(s.sh_offset) + Number(s.sh_size));
  }
  function readStr(table, idx) {
    if (!table || idx < 0 || idx >= table.byteLength) return '';
    let end = idx;
    while (end < table.byteLength && table[end] !== 0) end++;
    return new TextDecoder().decode(table.subarray(idx, end));
  }

  // Attach names to sections.
  for (const s of sections) s.name = readStr(shstr, s.sh_name);

  // ── Program header table ────────────────────────────────────────────────
  const segments = [];
  for (let i = 0; i < header.e_phnum; i++) {
    const base = Number(header.e_phoff) + i * header.e_phentsize;
    const ph = is64 ? {
      p_type:   u32(base + 0x00),
      p_flags:  u32(base + 0x04),
      p_offset: u64(base + 0x08),
      p_vaddr:  u64(base + 0x10),
      p_paddr:  u64(base + 0x18),
      p_filesz: u64(base + 0x20),
      p_memsz:  u64(base + 0x28),
      p_align:  u64(base + 0x30)
    } : {
      p_type:   u32(base + 0x00),
      p_offset: u32(base + 0x04),
      p_vaddr:  u32(base + 0x08),
      p_paddr:  u32(base + 0x0C),
      p_filesz: u32(base + 0x10),
      p_memsz:  u32(base + 0x14),
      p_flags:  u32(base + 0x18),
      p_align:  u32(base + 0x1C)
    };
    segments.push(ph);
  }

  // ── Symbols ─────────────────────────────────────────────────────────────
  // Find .symtab / .dynsym and their linked string tables. Each entry is
  // either Elf32_Sym (16 bytes) or Elf64_Sym (24 bytes).
  const symbols = [];
  const SHT_SYMTAB = 2;
  const SHT_DYNSYM = 11;
  for (const s of sections) {
    if (s.sh_type !== SHT_SYMTAB && s.sh_type !== SHT_DYNSYM) continue;
    const strSec = sections[s.sh_link];
    const strTable = strSec
      ? bytes.subarray(Number(strSec.sh_offset), Number(strSec.sh_offset) + Number(strSec.sh_size))
      : null;
    const entSize = is64 ? 24 : 16;
    const count = Math.floor(Number(s.sh_size) / entSize);
    const base = Number(s.sh_offset);
    for (let i = 0; i < count; i++) {
      const eo = base + i * entSize;
      const sym = is64 ? {
        st_name:  u32(eo + 0x00),
        st_info:  bytes[eo + 0x04],
        st_other: bytes[eo + 0x05],
        st_shndx: u16(eo + 0x06),
        st_value: u64(eo + 0x08),
        st_size:  u64(eo + 0x10)
      } : {
        st_name:  u32(eo + 0x00),
        st_value: u32(eo + 0x04),
        st_size:  u32(eo + 0x08),
        st_info:  bytes[eo + 0x0C],
        st_other: bytes[eo + 0x0D],
        st_shndx: u16(eo + 0x0E)
      };
      sym.name = readStr(strTable, sym.st_name);
      sym.bind = sym.st_info >> 4;          // STB_*
      sym.type = sym.st_info & 0xF;         // STT_*
      sym.fromSection = s.name;
      symbols.push(sym);
    }
  }

  return {
    is64,
    le,
    header,
    sections,
    segments,
    symbols
  };
}

// ── Pretty-print helpers ──────────────────────────────────────────────────

export const E_TYPE = {
  0: 'NONE', 1: 'REL', 2: 'EXEC', 3: 'DYN', 4: 'CORE'
};

export const E_MACHINE = {
  0:   'NONE',
  3:   'x86',
  20:  'PowerPC',
  21:  'PowerPC64',
  40:  'ARM',
  62:  'x86_64',
  183: 'AArch64',
  243: 'RISC-V'
};

export const SH_TYPE = {
  0:  'NULL',
  1:  'PROGBITS',
  2:  'SYMTAB',
  3:  'STRTAB',
  4:  'RELA',
  5:  'HASH',
  6:  'DYNAMIC',
  7:  'NOTE',
  8:  'NOBITS',
  9:  'REL',
  11: 'DYNSYM',
  14: 'INIT_ARRAY',
  15: 'FINI_ARRAY',
  16: 'PREINIT_ARRAY',
  17: 'GROUP',
  18: 'SYMTAB_SHNDX'
};

export const P_TYPE = {
  0: 'NULL',
  1: 'LOAD',
  2: 'DYNAMIC',
  3: 'INTERP',
  4: 'NOTE',
  5: 'SHLIB',
  6: 'PHDR',
  7: 'TLS',
  0x6474e550: 'GNU_EH_FRAME',
  0x6474e551: 'GNU_STACK',
  0x6474e552: 'GNU_RELRO',
  0x6474e553: 'GNU_PROPERTY'
};

export function sectionFlagsLabel(flags) {
  const f = typeof flags === 'bigint' ? Number(flags & 0xFFFFFFFFn) : flags;
  const parts = [];
  if (f & 0x1) parts.push('W');   // SHF_WRITE
  if (f & 0x2) parts.push('A');   // SHF_ALLOC
  if (f & 0x4) parts.push('X');   // SHF_EXECINSTR
  if (f & 0x10) parts.push('M');  // SHF_MERGE
  if (f & 0x20) parts.push('S');  // SHF_STRINGS
  if (f & 0x40) parts.push('I');  // SHF_INFO_LINK
  if (f & 0x80) parts.push('L');  // SHF_LINK_ORDER
  if (f & 0x200) parts.push('G'); // SHF_GROUP
  if (f & 0x400) parts.push('T'); // SHF_TLS
  return parts.join('');
}

export function segmentFlagsLabel(flags) {
  const parts = [];
  if (flags & 0x4) parts.push('R');
  if (flags & 0x2) parts.push('W');
  if (flags & 0x1) parts.push('X');
  return parts.join('');
}

export const ST_BIND = { 0: 'LOCAL', 1: 'GLOBAL', 2: 'WEAK' };
export const ST_TYPE = {
  0: 'NOTYPE', 1: 'OBJECT', 2: 'FUNC', 3: 'SECTION', 4: 'FILE',
  5: 'COMMON', 6: 'TLS'
};

export function hex(n, width) {
  const v = typeof n === 'bigint' ? n.toString(16) : (n >>> 0).toString(16);
  return '0x' + v.toUpperCase().padStart(width ?? 8, '0');
}

export function num(n) {
  return typeof n === 'bigint' ? n.toString() : String(n);
}
