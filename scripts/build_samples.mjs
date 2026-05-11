#!/usr/bin/env node
// Builds a handful of RV32 sample ELF files for users to drop into Scry.
// Output: web/v1/samples/*.elf
//
// Encoder is a small hand-rolled RV32I/M subset that takes a list of
// instructions in a string-DSL and emits 32-bit words. We then wrap the
// bytes in a minimal ELF32 (single PT_LOAD at 0x00010000, ecall halt).

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
  // imm is byte offset, must be multiple of 2
  const i = imm & 0x1FFE | (imm & 0x1000) | (imm & 0x800);
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
  ecall: () => 0x00000073,
  ebreak: () => 0x00100073
};

// --- two-pass assembler with labels ---
function assemble(prog) {
  // First pass: resolve label addresses.
  const labels = new Map();
  let pc = 0;
  for (const line of prog) {
    if (typeof line === 'string' && line.endsWith(':')) {
      labels.set(line.slice(0, -1), pc);
    } else {
      pc += 4;
    }
  }
  // Second pass: emit.
  const out = [];
  pc = 0;
  for (const line of prog) {
    if (typeof line === 'string' && line.endsWith(':')) continue;
    const [op, ...args] = line;
    const fn = ops[op];
    if (!fn) throw new Error(`unknown op ${op}`);
    // Resolve label references in branch/jal targets (last arg).
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

// --- ELF wrapper ---
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

// --- sample programs ---

// 1. Fibonacci(10) -> 55 in a2 (b)
const fib = [
  ['addi', 'a0', 'zero', 0],   // i = 0
  ['addi', 'a1', 'zero', 0],   // a = 0
  ['addi', 'a2', 'zero', 1],   // b = 1
  ['addi', 'a3', 'zero', 10],  // n = 10
  'loop:',
  ['beq', 'a0', 'a3', 'done'],
  ['add', 'a4', 'a1', 'a2'],   // tmp = a + b
  ['add', 'a1', 'a2', 'zero'], // a = b
  ['add', 'a2', 'a4', 'zero'], // b = tmp
  ['addi', 'a0', 'a0', 1],
  ['jal', 'zero', 'loop'],
  'done:',
  ['ecall']
];

// 2. SPI 4-byte JEDEC ID read (extended version of built-in demo)
const spiBase = 0x10000;  // upper 20 bits of 0x10000000
const spi = [
  ['lui', 't0', spiBase],       // t0 = 0x10000000
  ['sw', 't0', 'zero', 16],     // CS low
  ['addi', 'a0', 'zero', 0x9F],
  ['sw', 't0', 'a0', 8],        // TX 0x9F
  ['lw', 'a1', 't0', 12],       // RX
  ['sw', 't0', 'zero', 8],      // TX 0
  ['lw', 'a2', 't0', 12],       // RX
  ['sw', 't0', 'zero', 8],      // TX 0
  ['lw', 'a3', 't0', 12],       // RX
  ['sw', 't0', 'zero', 8],      // TX 0
  ['lw', 'a4', 't0', 12],       // RX
  ['addi', 'a5', 'zero', 1],
  ['sw', 't0', 'a5', 16],       // CS high
  ['ecall']
];

// 3. I2C bus scan: try addresses 0x08..0x10 with START / addr+W / STOP
//    Produces 9 short I2C transactions in Trace.
const i2cBase = 0x10000;
const i2cscan = [
  ['lui', 't0', i2cBase],
  ['addi', 't0', 't0', 0x100],  // t0 = 0x10000100 (I2C base)
  ['addi', 'a0', 'zero', 0x08], // current address (a0 = 8)
  ['addi', 'a1', 'zero', 0x11], // sentinel (stop at 0x11)
  'scan:',
  ['beq', 'a0', 'a1', 'done'],
  ['addi', 'a2', 'zero', 1],
  ['sw', 't0', 'a2', 0],        // START
  ['slli', 'a3', 'a0', 1],      // addr<<1 (write bit = 0)
  ['sw', 't0', 'a3', 8],        // send addr+W
  ['addi', 'a2', 'zero', 2],
  ['sw', 't0', 'a2', 0],        // STOP
  ['addi', 'a0', 'a0', 1],
  ['jal', 'zero', 'scan'],
  'done:',
  ['ecall']
];

// 4. Memcpy loop: copies 16 bytes from one buffer to another in RAM.
//    Demonstrates load/store without MMIO traffic (Trace stays empty).
const memcpy = [
  ['lui', 't0', 0x00020],       // src base = 0x00020000
  ['lui', 't1', 0x00021],       // dst base = 0x00021000... wait, lui shifts left 12
  // Note: lui imm 0x20 -> t0 = 0x20 << 12 = 0x20000. So set proper bases.
  ['addi', 'a0', 'zero', 16],   // count
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

// --- emit ---
mkdirSync(OUTDIR, { recursive: true });
const samples = [
  { name: 'demo-fib10.elf',    desc: 'Fibonacci(10) -> a2 = 55',           text: assemble(fib) },
  { name: 'demo-spi-jedec.elf', desc: 'SPI JEDEC ID read (4 bytes)',        text: assemble(spi) },
  { name: 'demo-i2c-scan.elf',  desc: 'I2C bus scan 0x08..0x10',            text: assemble(i2cscan) },
  { name: 'demo-memcpy.elf',    desc: 'Memcpy 16 bytes (no MMIO traffic)',  text: assemble(memcpy) }
];

for (const s of samples) {
  const bytes = buildElf(s.text);
  writeFileSync(join(OUTDIR, s.name), bytes);
  console.log(`wrote ${s.name}  (${s.text.length} insns, ${bytes.byteLength} bytes) - ${s.desc}`);
}

// Manifest for the in-app picker.
const manifest = samples.map(s => ({
  file: s.name,
  desc: s.desc,
  insns: s.text.length
}));
writeFileSync(join(OUTDIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote manifest.json (${manifest.length} entries)`);
