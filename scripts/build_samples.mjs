#!/usr/bin/env node
// Builds a handful of RV32 sample ELF files for users to drop into Scry.
// Output: web/v1/samples/*.elf
//
// Encoder is a small hand-rolled RV32I/M subset that takes a list of
// instructions in a string-DSL and emits 32-bit words. We then wrap the
// bytes in a minimal ELF32 (single PT_LOAD at 0x00010000, ecall halt).
//
// Two builder paths:
//   buildElf(text)              — minimal, single PT_LOAD, no section headers.
//                                 Used by the original tiny samples (fib/spi/i2c/memcpy).
//   buildElfRich({text, rodata, extra, symbols, entry})
//                              — full section-header table (.text, .rodata,
//                                 optional extra section, .symtab, .strtab,
//                                 .shstrtab). Used by the "visual fingerprint"
//                                 samples — bestiary (strings) and noise-chamber
//                                 (entropy band).

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTDIR = join(__dirname, '..', 'web', 'v1', 'samples');

// --- register table ---
const REG = {
  zero: 0, ra: 1, sp: 2, gp: 3, tp: 4, t0: 5, t1: 6, t2: 7,
  s0: 8, fp: 8, s1: 9,
  a0: 10, a1: 11, a2: 12, a3: 13, a4: 14, a5: 15, a6: 16, a7: 17,
  s2: 18, s3: 19, s4: 20, s5: 21, s6: 22, s7: 23, s8: 24, s9: 25, s10: 26, s11: 27,
  t3: 28, t4: 29, t5: 30, t6: 31
};
function r(name) {
  if (typeof name === 'number') return name & 31;
  if (REG[name] === undefined) throw new Error(`unknown reg ${name}`);
  return REG[name];
}

// --- instruction encoders ---
function encI(opcode, funct3, rd, rs1, imm) {
  const i = imm & 0xFFF;
  return ((i & 0xFFF) << 20) | ((rs1 & 31) << 15) | ((funct3 & 7) << 12) | ((rd & 31) << 7) | (opcode & 0x7F);
}
function encR(opcode, funct3, funct7, rd, rs1, rs2) {
  return ((funct7 & 0x7F) << 25) | ((rs2 & 31) << 20) | ((rs1 & 31) << 15) |
         ((funct3 & 7) << 12) | ((rd & 31) << 7) | (opcode & 0x7F);
}
function encS(opcode, funct3, rs1, rs2, imm) {
  const i = imm & 0xFFF;
  const imm115 = (i >> 5) & 0x7F;
  const imm40  = i & 0x1F;
  return (imm115 << 25) | ((rs2 & 31) << 20) | ((rs1 & 31) << 15) |
         ((funct3 & 7) << 12) | (imm40 << 7) | (opcode & 0x7F);
}
function encB(opcode, funct3, rs1, rs2, imm) {
  const b12  = (imm >> 12) & 1;
  const b11  = (imm >> 11) & 1;
  const b105 = (imm >> 5) & 0x3F;
  const b41  = (imm >> 1) & 0xF;
  return (b12 << 31) | (b105 << 25) | ((rs2 & 31) << 20) | ((rs1 & 31) << 15) |
         ((funct3 & 7) << 12) | (b41 << 8) | (b11 << 7) | (opcode & 0x7F);
}
function encU(opcode, rd, imm) {
  return ((imm & 0xFFFFF) << 12) | ((rd & 31) << 7) | (opcode & 0x7F);
}
function encJ(opcode, rd, imm) {
  const b20   = (imm >> 20) & 1;
  const b101  = (imm >> 1) & 0x3FF;
  const b11   = (imm >> 11) & 1;
  const b1912 = (imm >> 12) & 0xFF;
  return (b20 << 31) | (b101 << 21) | (b11 << 20) | (b1912 << 12) | ((rd & 31) << 7) | (opcode & 0x7F);
}

// --- mnemonics ---
const ops = {
  addi: (rd, rs1, imm) => encI(0x13, 0, r(rd), r(rs1), imm),
  andi: (rd, rs1, imm) => encI(0x13, 7, r(rd), r(rs1), imm),
  ori:  (rd, rs1, imm) => encI(0x13, 6, r(rd), r(rs1), imm),
  slli: (rd, rs1, sh)  => encI(0x13, 1, r(rd), r(rs1), sh & 31),
  srli: (rd, rs1, sh)  => encI(0x13, 5, r(rd), r(rs1), sh & 31),
  add:  (rd, rs1, rs2) => encR(0x33, 0, 0x00, r(rd), r(rs1), r(rs2)),
  sub:  (rd, rs1, rs2) => encR(0x33, 0, 0x20, r(rd), r(rs1), r(rs2)),
  mul:  (rd, rs1, rs2) => encR(0x33, 0, 0x01, r(rd), r(rs1), r(rs2)),
  sll:  (rd, rs1, rs2) => encR(0x33, 1, 0x00, r(rd), r(rs1), r(rs2)),
  lui:  (rd, imm)      => encU(0x37, r(rd), imm),
  lw:   (rd, rs1, imm) => encI(0x03, 2, r(rd), r(rs1), imm),
  sw:   (rs1, rs2, imm) => encS(0x23, 2, r(rs1), r(rs2), imm),
  beq:  (rs1, rs2, off) => encB(0x63, 0, r(rs1), r(rs2), off),
  bne:  (rs1, rs2, off) => encB(0x63, 1, r(rs1), r(rs2), off),
  blt:  (rs1, rs2, off) => encB(0x63, 4, r(rs1), r(rs2), off),
  bge:  (rs1, rs2, off) => encB(0x63, 5, r(rs1), r(rs2), off),
  jal:  (rd, off)      => encJ(0x6F, r(rd), off),
  nop:  ()             => encI(0x13, 0, 0, 0, 0),  // addi x0, x0, 0
  ecall: () => 0x00000073,
  ebreak: () => 0x00100073
};

// --- two-pass assembler with labels ---
function assemble(prog) {
  const labels = new Map();
  let pc = 0;
  for (const line of prog) {
    if (typeof line === 'string' && line.endsWith(':')) {
      labels.set(line.slice(0, -1), pc);
    } else {
      pc += 4;
    }
  }
  const out = [];
  pc = 0;
  for (const line of prog) {
    if (typeof line === 'string' && line.endsWith(':')) continue;
    const [op, ...args] = line;
    const fn = ops[op];
    if (!fn) throw new Error(`unknown op ${op}`);
    const resolved = args.map(a => {
      if (typeof a === 'string' && labels.has(a)) {
        return labels.get(a) - pc;
      }
      return a;
    });
    out.push(fn(...resolved) >>> 0);
    pc += 4;
  }
  return new Uint32Array(out);
}

// --- ELF wrapper (minimal — single PT_LOAD, no section table) ---
const ENTRY = 0x00010000;
function buildElf(text) {
  const TEXT_BYTES = text.length * 4;
  const phoff = 52;
  const text_off = 84;
  const total = text_off + TEXT_BYTES;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);

  u8[0] = 0x7F; u8[1] = 0x45; u8[2] = 0x4C; u8[3] = 0x46;
  u8[4] = 1; u8[5] = 1; u8[6] = 1;
  dv.setUint16(16, 2, true);
  dv.setUint16(18, 0xF3, true);
  dv.setUint32(20, 1, true);
  dv.setUint32(24, ENTRY, true);
  dv.setUint32(28, phoff, true);
  dv.setUint32(32, 0, true);
  dv.setUint32(36, 0, true);
  dv.setUint16(40, 52, true);
  dv.setUint16(42, 32, true);
  dv.setUint16(44, 1, true);
  dv.setUint16(46, 0, true);
  dv.setUint16(48, 0, true);
  dv.setUint16(50, 0, true);

  dv.setUint32(phoff + 0,  1, true);
  dv.setUint32(phoff + 4,  text_off, true);
  dv.setUint32(phoff + 8,  ENTRY, true);
  dv.setUint32(phoff + 12, ENTRY, true);
  dv.setUint32(phoff + 16, TEXT_BYTES, true);
  dv.setUint32(phoff + 20, TEXT_BYTES, true);
  dv.setUint32(phoff + 24, 5, true);
  dv.setUint32(phoff + 28, 0x1000, true);

  for (let i = 0; i < text.length; i++) {
    dv.setUint32(text_off + i * 4, text[i], true);
  }
  return new Uint8Array(buf);
}

// --- Rich ELF wrapper ---
// Emits a full ELF32 with section headers so INSPECT shows .text, .rodata,
// optional extra section, .symtab/.strtab, .shstrtab.
//
// Layout in file:
//   [ELF header 52] [PHDR 32] [.text] [.rodata] [extra?] [.symtab?] [.strtab?] [.shstrtab] [SHDRs]
//
// PT_LOAD covers .text + .rodata so the emulator can still execute.
// The extra section is NOT in PT_LOAD — it's "file-resident only", visible
// in INSPECT/HEX but not loaded into memory. That keeps the noise band from
// polluting the runtime image.
const SHT_NULL     = 0;
const SHT_PROGBITS = 1;
const SHT_SYMTAB   = 2;
const SHT_STRTAB   = 3;
const SHF_WRITE    = 0x1;
const SHF_ALLOC    = 0x2;
const SHF_EXEC     = 0x4;

function alignUp(n, a) { return (n + a - 1) & ~(a - 1); }

function makeStrtab(strings) {
  // strings: array of strings, including '' as first entry (offset 0 == empty).
  // Returns { bytes, offsets: Map<string, number> } where offsets[s] is the
  // byte offset of s within the table.
  const offsets = new Map();
  const parts = [];
  let cursor = 0;
  for (const s of strings) {
    if (!offsets.has(s)) {
      offsets.set(s, cursor);
      const enc = new TextEncoder().encode(s);
      parts.push(enc);
      parts.push(new Uint8Array([0]));
      cursor += enc.length + 1;
    }
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { bytes.set(p, pos); pos += p.length; }
  return { bytes, offsets };
}

function buildElfRich(spec) {
  const text   = spec.text;
  const rodata = spec.rodata   || new Uint8Array(0);
  const extra  = spec.extra    || null;   // { name, bytes, type, flags }
  const syms   = spec.symbols  || [];     // [{ name, value, size, sectionName, bind, type }]
  const entry  = spec.entry    ?? ENTRY;

  const TEXT_BYTES   = text.length * 4;
  const RODATA_BYTES = rodata.length;
  const EXTRA_BYTES  = extra ? extra.bytes.length : 0;

  // Compute file offsets.
  const ehSize  = 52;
  const phEnt   = 32;
  const phNum   = 1;
  const shEnt   = 40;

  const phoff   = ehSize;
  const text_off   = alignUp(phoff + phEnt * phNum, 4);
  const rodata_off = alignUp(text_off + TEXT_BYTES, 4);
  const extra_off  = extra ? alignUp(rodata_off + RODATA_BYTES, 4) : (rodata_off + RODATA_BYTES);

  // --- Section name string table (.shstrtab) ---
  const shNames = ['', '.text', '.rodata'];
  if (extra) shNames.push(extra.name);
  let symtab_present = syms.length > 0;
  if (symtab_present) {
    shNames.push('.symtab');
    shNames.push('.strtab');
  }
  shNames.push('.shstrtab');
  const shstrtab = makeStrtab(shNames);

  // --- Symbol string table (.strtab) ---
  let strtab = null;
  let symtab_bytes = null;
  if (symtab_present) {
    // strtab: '' + each symbol name (deduped).
    const names = [''];
    for (const s of syms) names.push(s.name);
    strtab = makeStrtab(names);

    // symtab: first entry is null (16 bytes of zero), then one entry per symbol.
    // Elf32_Sym: st_name(4) st_value(4) st_size(4) st_info(1) st_other(1) st_shndx(2)
    const entries = 1 + syms.length;
    symtab_bytes = new Uint8Array(entries * 16);
    const sdv = new DataView(symtab_bytes.buffer);
    // entry 0 is all zeros — already.
    for (let i = 0; i < syms.length; i++) {
      const s = syms[i];
      const eo = (i + 1) * 16;
      const nameOff = strtab.offsets.get(s.name);
      const shndx =
        s.sectionName === '.text'   ? 1 :
        s.sectionName === '.rodata' ? 2 :
        s.sectionName === extra?.name ? 3 :
        0;
      const bind = (s.bind ?? 1) & 0xF;   // STB_GLOBAL default
      const type = (s.type ?? 1) & 0xF;   // STT_OBJECT default
      sdv.setUint32(eo + 0,  nameOff,    true);
      sdv.setUint32(eo + 4,  s.value,    true);
      sdv.setUint32(eo + 8,  s.size ?? 0, true);
      symtab_bytes[eo + 12] = (bind << 4) | type;
      symtab_bytes[eo + 13] = 0;
      sdv.setUint16(eo + 14, shndx, true);
    }
  }

  // Compute remaining offsets.
  const symtab_off   = symtab_present ? alignUp(extra_off + EXTRA_BYTES, 4) : 0;
  const symtab_size  = symtab_present ? symtab_bytes.length : 0;
  const strtab_off   = symtab_present ? alignUp(symtab_off + symtab_size, 1) : 0;
  const strtab_size  = symtab_present ? strtab.bytes.length : 0;
  const shstrtab_off = symtab_present
    ? alignUp(strtab_off + strtab_size, 1)
    : alignUp(extra_off + EXTRA_BYTES, 1);
  const shstrtab_size = shstrtab.bytes.length;
  const shoff = alignUp(shstrtab_off + shstrtab_size, 4);

  // Section header count (NULL + .text + .rodata + extra? + symtab? + strtab? + .shstrtab)
  let shnum = 4; // NULL, .text, .rodata, .shstrtab
  if (extra) shnum++;
  if (symtab_present) shnum += 2;

  // .shstrtab is always last.
  const shstrtab_ndx = shnum - 1;
  // symtab/strtab indices
  const extra_ndx   = extra ? 3 : 0;
  const symtab_ndx  = symtab_present ? (extra ? 4 : 3) : 0;
  const strtab_ndx  = symtab_present ? (extra ? 5 : 4) : 0;

  const total = shoff + shnum * shEnt;
  const buf   = new ArrayBuffer(total);
  const dv    = new DataView(buf);
  const u8    = new Uint8Array(buf);

  // --- ELF header ---
  u8[0] = 0x7F; u8[1] = 0x45; u8[2] = 0x4C; u8[3] = 0x46;
  u8[4] = 1;   // EI_CLASS = 32
  u8[5] = 1;   // EI_DATA = little
  u8[6] = 1;   // EI_VERSION
  dv.setUint16(16, 2, true);       // e_type = EXEC
  dv.setUint16(18, 0xF3, true);    // e_machine = RISC-V
  dv.setUint32(20, 1, true);       // e_version
  dv.setUint32(24, entry, true);   // e_entry
  dv.setUint32(28, phoff, true);   // e_phoff
  dv.setUint32(32, shoff, true);   // e_shoff
  dv.setUint32(36, 0, true);       // e_flags
  dv.setUint16(40, ehSize, true);  // e_ehsize
  dv.setUint16(42, phEnt, true);   // e_phentsize
  dv.setUint16(44, phNum, true);   // e_phnum
  dv.setUint16(46, shEnt, true);   // e_shentsize
  dv.setUint16(48, shnum, true);   // e_shnum
  dv.setUint16(50, shstrtab_ndx, true);  // e_shstrndx

  // --- Program header: one PT_LOAD covering .text + .rodata ---
  // (Extra section is not loaded.)
  const loadFileSize = (rodata_off - text_off) + RODATA_BYTES;
  dv.setUint32(phoff + 0,  1, true);              // p_type = LOAD
  dv.setUint32(phoff + 4,  text_off, true);       // p_offset
  dv.setUint32(phoff + 8,  entry, true);          // p_vaddr
  dv.setUint32(phoff + 12, entry, true);          // p_paddr
  dv.setUint32(phoff + 16, loadFileSize, true);   // p_filesz
  dv.setUint32(phoff + 20, loadFileSize, true);   // p_memsz
  dv.setUint32(phoff + 24, 5, true);              // p_flags = R+X
  dv.setUint32(phoff + 28, 0x1000, true);         // p_align

  // --- .text bytes ---
  for (let i = 0; i < text.length; i++) {
    dv.setUint32(text_off + i * 4, text[i], true);
  }
  // --- .rodata bytes ---
  u8.set(rodata, rodata_off);
  // --- extra section bytes ---
  if (extra) u8.set(extra.bytes, extra_off);
  // --- symtab + strtab ---
  if (symtab_present) {
    u8.set(symtab_bytes, symtab_off);
    u8.set(strtab.bytes, strtab_off);
  }
  // --- shstrtab ---
  u8.set(shstrtab.bytes, shstrtab_off);

  // --- Section headers ---
  function writeSh(idx, fields) {
    const o = shoff + idx * shEnt;
    dv.setUint32(o + 0x00, fields.name,   true);
    dv.setUint32(o + 0x04, fields.type,   true);
    dv.setUint32(o + 0x08, fields.flags,  true);
    dv.setUint32(o + 0x0C, fields.addr,   true);
    dv.setUint32(o + 0x10, fields.offset, true);
    dv.setUint32(o + 0x14, fields.size,   true);
    dv.setUint32(o + 0x18, fields.link,   true);
    dv.setUint32(o + 0x1C, fields.info,   true);
    dv.setUint32(o + 0x20, fields.align,  true);
    dv.setUint32(o + 0x24, fields.entsize, true);
  }

  // 0: NULL
  writeSh(0, { name: 0, type: 0, flags: 0, addr: 0, offset: 0, size: 0, link: 0, info: 0, align: 0, entsize: 0 });
  // 1: .text
  writeSh(1, {
    name: shstrtab.offsets.get('.text'),
    type: SHT_PROGBITS,
    flags: SHF_ALLOC | SHF_EXEC,
    addr: entry,
    offset: text_off,
    size: TEXT_BYTES,
    link: 0, info: 0, align: 4, entsize: 0
  });
  // 2: .rodata
  writeSh(2, {
    name: shstrtab.offsets.get('.rodata'),
    type: SHT_PROGBITS,
    flags: SHF_ALLOC,
    addr: entry + (rodata_off - text_off),
    offset: rodata_off,
    size: RODATA_BYTES,
    link: 0, info: 0, align: 4, entsize: 0
  });
  // 3: extra (optional)
  if (extra) {
    writeSh(extra_ndx, {
      name: shstrtab.offsets.get(extra.name),
      type: extra.type ?? SHT_PROGBITS,
      flags: extra.flags ?? 0,
      addr: 0,
      offset: extra_off,
      size: EXTRA_BYTES,
      link: 0, info: 0, align: 4, entsize: 0
    });
  }
  // symtab + strtab (optional)
  if (symtab_present) {
    writeSh(symtab_ndx, {
      name: shstrtab.offsets.get('.symtab'),
      type: SHT_SYMTAB,
      flags: 0,
      addr: 0,
      offset: symtab_off,
      size: symtab_size,
      link: strtab_ndx,
      info: 1,             // index of first non-local; we keep it simple
      align: 4,
      entsize: 16
    });
    writeSh(strtab_ndx, {
      name: shstrtab.offsets.get('.strtab'),
      type: SHT_STRTAB,
      flags: 0,
      addr: 0,
      offset: strtab_off,
      size: strtab_size,
      link: 0, info: 0, align: 1, entsize: 0
    });
  }
  // last: .shstrtab
  writeSh(shstrtab_ndx, {
    name: shstrtab.offsets.get('.shstrtab'),
    type: SHT_STRTAB,
    flags: 0,
    addr: 0,
    offset: shstrtab_off,
    size: shstrtab_size,
    link: 0, info: 0, align: 1, entsize: 0
  });

  return new Uint8Array(buf);
}

// --- sample programs ---

// 1. Fibonacci(10) -> 55 in a2 (b)
const fib = [
  ['addi', 'a0', 'zero', 0],
  ['addi', 'a1', 'zero', 0],
  ['addi', 'a2', 'zero', 1],
  ['addi', 'a3', 'zero', 10],
  'loop:',
  ['beq', 'a0', 'a3', 'done'],
  ['add', 'a4', 'a1', 'a2'],
  ['add', 'a1', 'a2', 'zero'],
  ['add', 'a2', 'a4', 'zero'],
  ['addi', 'a0', 'a0', 1],
  ['jal', 'zero', 'loop'],
  'done:',
  ['ecall']
];

// 2. SPI JEDEC ID read
const spiBase = 0x10000;
const spi = [
  ['lui', 't0', spiBase],
  ['sw', 't0', 'zero', 16],
  ['addi', 'a0', 'zero', 0x9F],
  ['sw', 't0', 'a0', 8],
  ['lw', 'a1', 't0', 12],
  ['sw', 't0', 'zero', 8],
  ['lw', 'a2', 't0', 12],
  ['sw', 't0', 'zero', 8],
  ['lw', 'a3', 't0', 12],
  ['sw', 't0', 'zero', 8],
  ['lw', 'a4', 't0', 12],
  ['addi', 'a5', 'zero', 1],
  ['sw', 't0', 'a5', 16],
  ['ecall']
];

// 3. I2C scan
const i2cBase = 0x10000;
const i2cscan = [
  ['lui', 't0', i2cBase],
  ['addi', 't0', 't0', 0x100],
  ['addi', 'a0', 'zero', 0x08],
  ['addi', 'a1', 'zero', 0x11],
  'scan:',
  ['beq', 'a0', 'a1', 'done'],
  ['addi', 'a2', 'zero', 1],
  ['sw', 't0', 'a2', 0],
  ['slli', 'a3', 'a0', 1],
  ['sw', 't0', 'a3', 8],
  ['addi', 'a2', 'zero', 2],
  ['sw', 't0', 'a2', 0],
  ['addi', 'a0', 'a0', 1],
  ['jal', 'zero', 'scan'],
  'done:',
  ['ecall']
];

// 4. Memcpy
const memcpy = [
  ['lui', 't0', 0x00020],
  ['lui', 't1', 0x00021],
  ['addi', 'a0', 'zero', 16],
  'cp:',
  ['beq', 'a0', 'zero', 'done'],
  ['lw',  'a1', 't0', 0],
  ['sw',  't1', 'a1', 0],
  ['addi', 't0', 't0', 4],
  ['addi', 't1', 't1', 4],
  ['addi', 'a0', 'a0', -4],
  ['jal', 'zero', 'cp'],
  'done:',
  ['ecall']
];

// 5. demo-strings-bestiary — heavy .rodata, low-entropy plateau.
//    The visual is the point: the entropy strip should show a calm plateau
//    where rodata sits, and STRINGS / SYMBOLS have a lot to chew on.
const bestiary_text = assemble([
  ['nop'],
  ['nop'],
  ['nop'],
  ['nop'],
  ['ecall']
]);

const bestiary_strings = [
  // Banner
  '== SCRY BESTIARY · sample binary ·==',
  'a workbench for looking at things',
  '',
  // Poem (low entropy, evocative)
  'a binary is a fossil — but also a key.',
  'each byte holds intention,',
  'each section a small chamber',
  'where the engineer left a note for whoever comes next.',
  'scry is the lantern. you are the reader.',
  '',
  // Symbol-ish names
  '__rodata_start',
  '__rodata_end',
  '__text_start',
  '__bss_end',
  'scry_banner',
  'scry_version',
  'scry_build_date',
  'g_pad_buffer',
  '',
  // Fake plausible API endpoints
  'POST /v1/scry/inspect',
  'POST /v1/scry/disasm',
  'GET  /v1/scry/strings?filter=',
  'GET  /v1/scry/sections',
  'WS   /v1/scry/emu/trace',
  '',
  // JEDEC vendor codes (a classic SPI flash reference table)
  '0xEF Winbond',
  '0xC2 Macronix',
  '0xC8 GigaDevice',
  '0x20 Micron',
  '0x9D ISSI',
  '0xBF SST',
  '0x01 Spansion',
  '0x1F Atmel',
  '0xE0 Paragon',
  '0x68 Boya',
  '0x85 Puya',
  '0x5E Zbit',
  '',
  // Mini ISA / arch labels
  'rv32 · rv32i · rv32im · rv32imac',
  'risc-v · elf32 · little-endian · 32-bit',
  '',
  // Build provenance
  'build: scry@0.1.0',
  'compiler: hand-rolled in node.mjs',
  'license: MIT',
  '',
  // A few one-liners
  'every row is a jump.',
  'navigate by texture.',
  'no upload. no login. local only.',
  'the chrome stays out of the way.',
  '',
  // Tail marker
  '__bestiary_end__'
];
const bestiary_rodata_str = bestiary_strings.join('\n') + '\n';
const bestiary_rodata = new Uint8Array(new TextEncoder().encode(bestiary_rodata_str));

const bestiary_symbols = [
  // Make symbols point at known offsets within their section. Values are
  // virtual addresses (entry + offset-in-section).
  // .text is at ENTRY, .rodata follows .text.
  { name: '_start',         value: ENTRY,                                   size: 20, sectionName: '.text',   type: 2 }, // FUNC
  { name: '_halt',          value: ENTRY + 16,                              size: 4,  sectionName: '.text',   type: 2 },
  { name: 'scry_banner',    value: ENTRY + alignUp(20, 4),                  size: 40, sectionName: '.rodata', type: 1 }, // OBJECT
  { name: '__rodata_start', value: ENTRY + alignUp(20, 4),                  size: 0,  sectionName: '.rodata', type: 1 },
  { name: '__rodata_end',   value: ENTRY + alignUp(20, 4) + bestiary_rodata.length, size: 0, sectionName: '.rodata', type: 1 },
  { name: 'scry_version',   value: ENTRY + alignUp(20, 4) + 0x40,           size: 16, sectionName: '.rodata', type: 1 },
  { name: 'g_pad_buffer',   value: ENTRY + alignUp(20, 4) + 0x200,          size: 64, sectionName: '.rodata', type: 1 }
];

// 6. demo-noise-chamber — high-entropy band in a non-loaded section.
//    The strip should show a calm region (text + small rodata) and then a
//    sharp band of ~7.7+ bits where the PRNG fills .scry.noise.
const noise_text = assemble([
  ['nop'],
  ['nop'],
  ['nop'],
  ['ecall']
]);

const noise_rodata_str =
  '== SCRY NOISE CHAMBER · sample binary ==\n' +
  'high-entropy region follows in .scry.noise\n' +
  'prng: xorshift32 seeded with 0xCAFEBABE\n' +
  'reproducible by build_samples.mjs\n' +
  'see docs/superpowers/specs/2026-05-11-scry-design.md\n' +
  '\n' +
  'label_text_start\n' +
  'label_text_end\n' +
  'label_noise_start\n' +
  'label_noise_end\n';
const noise_rodata = new Uint8Array(new TextEncoder().encode(noise_rodata_str));

// xorshift32 — deterministic, 2KB of noise.
function xorshiftFill(seed, n) {
  let s = seed >>> 0;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    out[i] = s & 0xFF;
  }
  return out;
}
const noise_bytes = xorshiftFill(0xCAFEBABE, 2048);

const noise_symbols = [
  { name: '_start',           value: ENTRY,                        size: 16, sectionName: '.text',       type: 2 },
  { name: 'label_text_end',   value: ENTRY + 16,                   size: 0,  sectionName: '.text',       type: 1 },
  { name: 'label_noise_start',value: 0,                            size: 0,  sectionName: '.scry.noise', type: 1 },
  { name: 'label_noise_end',  value: noise_bytes.length,           size: 0,  sectionName: '.scry.noise', type: 1 }
];

// --- WAV sample: a sine sweep that looks like a swelling tide on the
//     waveform pane and produces a recognizable spectrum on the entropy
//     strip. 8 kHz mono 16-bit PCM, 1.5 s long, 220 Hz -> 880 Hz exponential.
function buildSineSweepWav(seconds = 1.5, sampleRate = 8000, f0 = 220, f1 = 880) {
  const total = Math.floor(seconds * sampleRate);
  // Exponential frequency sweep: f(t) = f0 * (f1/f0)^(t/T).
  // Phase = 2π ∫ f(t) dt = 2π · f0 · T · ((f1/f0)^(t/T) - 1) / ln(f1/f0)
  const T = seconds;
  const k = Math.log(f1 / f0);
  const samples = new Int16Array(total);
  // Add a gentle attack + release envelope so the waveform peaks read as a
  // breath rather than a brick. 50 ms in, 100 ms out.
  const ATTACK  = Math.floor(0.050 * sampleRate);
  const RELEASE = Math.floor(0.100 * sampleRate);
  for (let i = 0; i < total; i++) {
    const t = i / sampleRate;
    const phase = 2 * Math.PI * f0 * T / k * (Math.exp(k * t / T) - 1);
    let env = 1;
    if (i < ATTACK) env = i / ATTACK;
    else if (i > total - RELEASE) env = (total - i) / RELEASE;
    samples[i] = Math.round(Math.sin(phase) * 0.6 * 32767 * env);
  }

  // WAV (RIFF) container.
  const dataBytes = samples.length * 2;
  const headerSize = 44;
  const buf = new ArrayBuffer(headerSize + dataBytes);
  const dv  = new DataView(buf);
  const u8  = new Uint8Array(buf);
  function wstr(off, s) {
    for (let i = 0; i < s.length; i++) u8[off + i] = s.charCodeAt(i);
  }
  wstr(0, 'RIFF');
  dv.setUint32(4, 36 + dataBytes, true);
  wstr(8, 'WAVE');
  wstr(12, 'fmt ');
  dv.setUint32(16, 16, true);          // fmt chunk size
  dv.setUint16(20, 1, true);            // PCM
  dv.setUint16(22, 1, true);            // channels = 1
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true); // byte rate
  dv.setUint16(32, 2, true);            // block align
  dv.setUint16(34, 16, true);           // bits per sample
  wstr(36, 'data');
  dv.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    dv.setInt16(headerSize + i * 2, samples[i], true);
  }
  return new Uint8Array(buf);
}

// --- emit ---
mkdirSync(OUTDIR, { recursive: true });

// Helper: build a rich ELF with .text section and symbols from an
// assembled program. Labels in the source become FUNC symbols.
function richFromAssembly(prog, extraSymbols = []) {
  const text = assemble(prog);
  // Extract labels from the program to create symbols.
  const symbols = [];
  let pc = 0;
  for (const line of prog) {
    if (typeof line === 'string' && line.endsWith(':')) {
      const name = line.slice(0, -1);
      symbols.push({ name, value: ENTRY + pc, size: 4, sectionName: '.text', type: 2 });
    } else {
      pc += 4;
    }
  }
  symbols.push({ name: '_start', value: ENTRY, size: text.length * 4, sectionName: '.text', type: 2 });
  symbols.push(...extraSymbols);
  return buildElfRich({ text, rodata: new Uint8Array(0), symbols });
}

const samples = [
  {
    name: 'demo-fib10.elf',
    desc: 'Fibonacci(10) -> a2 = 55',
    bytes: richFromAssembly(fib),
    insns: fib.filter(l => Array.isArray(l)).length
  },
  {
    name: 'demo-spi-jedec.elf',
    desc: 'SPI JEDEC ID read (4 bytes via MMIO)',
    bytes: richFromAssembly(spi),
    insns: spi.filter(l => Array.isArray(l)).length
  },
  {
    name: 'demo-i2c-scan.elf',
    desc: 'I2C bus scan 0x08..0x10',
    bytes: richFromAssembly(i2cscan),
    insns: i2cscan.filter(l => Array.isArray(l)).length
  },
  {
    name: 'demo-memcpy.elf',
    desc: 'Memcpy loop (registers + RAM, no MMIO)',
    bytes: richFromAssembly(memcpy),
    insns: memcpy.filter(l => Array.isArray(l)).length
  },
  {
    name: 'demo-strings-bestiary.elf',
    desc: 'Strings + symbols showcase (low-entropy rodata)',
    bytes: buildElfRich({
      text:    bestiary_text,
      rodata:  bestiary_rodata,
      symbols: bestiary_symbols
    }),
    insns: bestiary_text.length
  },
  {
    name: 'demo-noise-chamber.elf',
    desc: 'High-entropy band via PRNG-filled section',
    bytes: buildElfRich({
      text:    noise_text,
      rodata:  noise_rodata,
      extra:   { name: '.scry.noise', bytes: noise_bytes, type: SHT_PROGBITS, flags: 0 },
      symbols: noise_symbols
    }),
    insns: noise_text.length
  },
  {
    name: 'demo-sine-sweep.wav',
    desc: 'Sine sweep 220Hz->880Hz, 1.5s mono PCM',
    bytes: buildSineSweepWav(),
    insns: 0
  }
];

for (const s of samples) {
  writeFileSync(join(OUTDIR, s.name), s.bytes);
  console.log(`wrote ${s.name}  (${s.insns} insns, ${s.bytes.byteLength} bytes) - ${s.desc}`);
}

// Manifest for the in-app picker.
const manifest = samples.map(s => ({
  file: s.name,
  desc: s.desc,
  insns: s.insns
}));
writeFileSync(join(OUTDIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote manifest.json (${manifest.length} entries)`);
