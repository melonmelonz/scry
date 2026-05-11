// RV32IMA disassembler. Hand-rolled, table-driven, pure JS.
// Returns one decoded instruction per call. The caller walks the bytes.
//
// RV32 instructions are 32-bit, little-endian. The compressed (C) extension
// allows 16-bit instructions — not supported here.
//
// References:
//   - "RISC-V Unprivileged ISA Specification" v2.2

export const ABI = [
  'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2',
  's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5',
  'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7',
  's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6'
];

function rd(i)     { return (i >>> 7)  & 0x1F; }
function rs1(i)    { return (i >>> 15) & 0x1F; }
function rs2(i)    { return (i >>> 20) & 0x1F; }
function funct3(i) { return (i >>> 12) & 0x7;  }
function funct7(i) { return (i >>> 25) & 0x7F; }
function opcode(i) { return i & 0x7F; }

// Immediate decoders. JS `>>` is arithmetic (sign-extends) for 32-bit ints.
function immI(i) { return i >> 20; }
function immS(i) { return ((i >> 25) << 5) | ((i >>> 7) & 0x1F); }
function immB(i) {
  return ((i >> 31) << 12)
       | (((i >>> 7)  & 0x01) << 11)
       | (((i >>> 25) & 0x3F) << 5)
       | (((i >>> 8)  & 0x0F) << 1);
}
function immU(i) { return i & 0xFFFFF000; }
function immJ(i) {
  return ((i >> 31) << 20)
       | (((i >>> 12) & 0xFF)  << 12)
       | (((i >>> 20) & 0x01)  << 11)
       | (((i >>> 21) & 0x3FF) << 1);
}

function hex(n, w = 8) {
  return '0x' + ((n >>> 0).toString(16).toUpperCase()).padStart(w, '0');
}

function signed(n) {
  // Already a 32-bit signed JS integer; format as decimal with sign.
  return (n < 0 ? '-' : '') + Math.abs(n).toString();
}

// Decode a single 32-bit instruction word at `pc`. Returns:
//   { pc, raw, mnemonic, operands, kind, target? }
// kind ∈ 'op' | 'branch' | 'jump' | 'load' | 'store' | 'system' | 'unknown'
// target (number) is the absolute address for branches/jumps when computable.
export function decode(word, pc) {
  const i = word | 0;
  const op = opcode(i);

  // Helpers for common operand formats.
  const R = (mn, comment) => out(mn, `${ABI[rd(i)]}, ${ABI[rs1(i)]}, ${ABI[rs2(i)]}`, 'op', null, comment);
  const I = (mn) => out(mn, `${ABI[rd(i)]}, ${ABI[rs1(i)]}, ${signed(immI(i))}`, 'op');
  const SHIFT = (mn, shamt) => out(mn, `${ABI[rd(i)]}, ${ABI[rs1(i)]}, ${shamt}`, 'op');
  const LD = (mn) => out(mn, `${ABI[rd(i)]}, ${signed(immI(i))}(${ABI[rs1(i)]})`, 'load');
  const ST = (mn) => out(mn, `${ABI[rs2(i)]}, ${signed(immS(i))}(${ABI[rs1(i)]})`, 'store');
  const B  = (mn) => {
    const off = immB(i);
    const target = (pc + off) >>> 0;
    return out(mn, `${ABI[rs1(i)]}, ${ABI[rs2(i)]}, ${hex(target, 8)}`, 'branch', target);
  };

  function out(mnemonic, operands, kind = 'op', target = null, comment) {
    return { pc, raw: i >>> 0, mnemonic, operands, kind, target, comment };
  }

  switch (op) {
    case 0x37: return out('lui',   `${ABI[rd(i)]}, ${hex(immU(i) >>> 12, 5)}`, 'op');
    case 0x17: return out('auipc', `${ABI[rd(i)]}, ${hex(immU(i) >>> 12, 5)}`, 'op');
    case 0x6F: {
      const off = immJ(i);
      const target = (pc + off) >>> 0;
      const mnem = rd(i) === 0 ? 'j' : (rd(i) === 1 ? 'jal' : 'jal');
      const ops = rd(i) === 0 ? hex(target, 8) : `${ABI[rd(i)]}, ${hex(target, 8)}`;
      return out(mnem, ops, 'jump', target);
    }
    case 0x67: {
      // jalr — also captures `ret` pseudo (jalr zero, ra, 0)
      if (rd(i) === 0 && rs1(i) === 1 && immI(i) === 0) {
        return out('ret', '', 'jump', null);
      }
      return out('jalr', `${ABI[rd(i)]}, ${signed(immI(i))}(${ABI[rs1(i)]})`, 'jump', null);
    }
    case 0x63: {
      switch (funct3(i)) {
        case 0: return B('beq');
        case 1: return B('bne');
        case 4: return B('blt');
        case 5: return B('bge');
        case 6: return B('bltu');
        case 7: return B('bgeu');
        default: return out(`branch?`, `funct3=${funct3(i)}`, 'unknown');
      }
    }
    case 0x03: {
      switch (funct3(i)) {
        case 0: return LD('lb');
        case 1: return LD('lh');
        case 2: return LD('lw');
        case 4: return LD('lbu');
        case 5: return LD('lhu');
        default: return out(`load?`, `funct3=${funct3(i)}`, 'unknown');
      }
    }
    case 0x23: {
      switch (funct3(i)) {
        case 0: return ST('sb');
        case 1: return ST('sh');
        case 2: return ST('sw');
        default: return out(`store?`, `funct3=${funct3(i)}`, 'unknown');
      }
    }
    case 0x13: {
      // OP-IMM
      switch (funct3(i)) {
        case 0: {
          // addi — special-cases: nop (addi zero,zero,0), mv (addi rd, rs1, 0), li (addi rd, zero, imm)
          if (i === 0x00000013) return out('nop', '', 'op');
          if (immI(i) === 0 && rd(i) !== 0) return out('mv', `${ABI[rd(i)]}, ${ABI[rs1(i)]}`, 'op');
          if (rs1(i) === 0 && rd(i) !== 0) return out('li', `${ABI[rd(i)]}, ${signed(immI(i))}`, 'op');
          return I('addi');
        }
        case 1: return SHIFT('slli', rs2(i));
        case 2: return I('slti');
        case 3: return I('sltiu');
        case 4: return I('xori');
        case 5: return (funct7(i) === 0x20) ? SHIFT('srai', rs2(i)) : SHIFT('srli', rs2(i));
        case 6: return I('ori');
        case 7: return I('andi');
      }
      return out('op-imm?', '', 'unknown');
    }
    case 0x33: {
      // OP / OP-RV32M
      if (funct7(i) === 0x01) {
        // RV32M
        switch (funct3(i)) {
          case 0: return R('mul');
          case 1: return R('mulh');
          case 2: return R('mulhsu');
          case 3: return R('mulhu');
          case 4: return R('div');
          case 5: return R('divu');
          case 6: return R('rem');
          case 7: return R('remu');
        }
      }
      switch (funct3(i)) {
        case 0: return (funct7(i) === 0x20) ? R('sub') : R('add');
        case 1: return R('sll');
        case 2: return R('slt');
        case 3: return R('sltu');
        case 4: return R('xor');
        case 5: return (funct7(i) === 0x20) ? R('sra') : R('srl');
        case 6: return R('or');
        case 7: return R('and');
      }
      return out('op?', '', 'unknown');
    }
    case 0x0F: {
      // FENCE family. Not bothering with full pred/succ decode for v1.
      return out('fence', '', 'op');
    }
    case 0x73: {
      // SYSTEM: ECALL, EBREAK, and CSR ops
      if (funct3(i) === 0) {
        const imm = immI(i) & 0xFFF;
        if (imm === 0) return out('ecall', '', 'system');
        if (imm === 1) return out('ebreak', '', 'system');
        if (imm === 0x302) return out('mret', '', 'system');
        if (imm === 0x102) return out('sret', '', 'system');
        if (imm === 0x002) return out('uret', '', 'system');
        if (imm === 0x105) return out('wfi', '', 'system');
        return out('system?', hex(imm, 3), 'unknown');
      }
      const csr = immI(i) & 0xFFF;
      const csrLabel = hex(csr, 3);
      switch (funct3(i)) {
        case 1: return out('csrrw',  `${ABI[rd(i)]}, ${csrLabel}, ${ABI[rs1(i)]}`, 'system');
        case 2: return out('csrrs',  `${ABI[rd(i)]}, ${csrLabel}, ${ABI[rs1(i)]}`, 'system');
        case 3: return out('csrrc',  `${ABI[rd(i)]}, ${csrLabel}, ${ABI[rs1(i)]}`, 'system');
        case 5: return out('csrrwi', `${ABI[rd(i)]}, ${csrLabel}, ${rs1(i)}`, 'system');
        case 6: return out('csrrsi', `${ABI[rd(i)]}, ${csrLabel}, ${rs1(i)}`, 'system');
        case 7: return out('csrrci', `${ABI[rd(i)]}, ${csrLabel}, ${rs1(i)}`, 'system');
      }
      return out('system?', '', 'unknown');
    }
    case 0x2F: {
      // RV32A — atomics (load-reserved, store-conditional, AMO). Decode shape
      // only; details (aq/rl) folded into mnemonic.
      const f5 = (i >>> 27) & 0x1F;
      const map = {
        0x02: 'lr.w', 0x03: 'sc.w', 0x01: 'amoswap.w', 0x00: 'amoadd.w',
        0x04: 'amoxor.w', 0x0C: 'amoand.w', 0x08: 'amoor.w',
        0x10: 'amomin.w', 0x14: 'amomax.w', 0x18: 'amominu.w', 0x1C: 'amomaxu.w'
      };
      const mn = map[f5] ?? 'amo?';
      return out(mn, `${ABI[rd(i)]}, ${ABI[rs2(i)]}, (${ABI[rs1(i)]})`, 'op');
    }
  }

  // Unknown / 16-bit (compressed) — flag explicitly.
  if ((i & 3) !== 3) {
    return out('(c)', hex(i & 0xFFFF, 4), 'unknown');
  }
  return out('(unknown)', hex(i, 8), 'unknown');
}

// Walk a byte range and emit decoded instructions at 4-byte stride.
// `baseAddr` is the virtual address corresponding to `bytes[startOffset]`.
// Returns array of decoded objects with `pc` set to the virtual address.
export function disassembleRange(bytes, startOffset, length, baseAddr) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  const end = Math.min(startOffset + length, bytes.byteLength) - 3;
  for (let off = startOffset; off < end; off += 4) {
    const word = dv.getUint32(off, true);
    const pc = (baseAddr + (off - startOffset)) >>> 0;
    out.push(decode(word, pc));
  }
  return out;
}
