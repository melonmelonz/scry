// RV32IMA interpreter. Hand-rolled. Pure JS. Designed for clarity over
// peak throughput; the typical demo runs at thousands to millions of cycles
// per second in a browser, more than enough for a visible bus trace.
//
// Convention: registers are Int32Array (signed); we use `>>> 0` to coerce
// to unsigned where the spec calls for it. x0 is forced to 0 after every
// step. PC is an unsigned 32-bit value.

export const ABI = [
  'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2',
  's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5',
  'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7',
  's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6'
];

function signExtend(v, bits) {
  const m = 1 << (bits - 1);
  return (v ^ m) - m;
}

export class CPU {
  constructor(memory, entry, sp) {
    this.mem = memory;
    this.x = new Int32Array(32);
    this.pc = entry >>> 0;
    this.cycles = 0;
    this.halted = false;
    this.haltReason = null;
    this.lastEvent = null;     // { kind, ... } — set by ecall/ebreak
    if (sp !== undefined) this.x[2] = sp | 0;
  }

  reset(entry, sp) {
    this.x.fill(0);
    this.pc = entry >>> 0;
    this.cycles = 0;
    this.halted = false;
    this.haltReason = null;
    this.lastEvent = null;
    if (sp !== undefined) this.x[2] = sp | 0;
  }

  // Execute exactly one instruction. Returns false if halted, true otherwise.
  step() {
    if (this.halted) return false;
    let word;
    try {
      word = this.mem.readU32(this.pc);
    } catch (e) {
      this.halted = true;
      this.haltReason = `bad fetch at 0x${this.pc.toString(16)}: ${e.message}`;
      return false;
    }
    const nextPc = this.execute(word);
    this.x[0] = 0;                 // hardwired zero
    this.pc = (nextPc >>> 0);
    this.cycles++;
    return !this.halted;
  }

  // Run up to `n` steps. Stops early on halt. Returns steps executed.
  run(n) {
    let i = 0;
    while (i < n && !this.halted) {
      if (!this.step()) break;
      i++;
    }
    return i;
  }

  execute(i) {
    const op = i & 0x7F;
    const rd = (i >>> 7) & 0x1F;
    const f3 = (i >>> 12) & 0x7;
    const rs1 = (i >>> 15) & 0x1F;
    const rs2 = (i >>> 20) & 0x1F;
    const f7 = (i >>> 25) & 0x7F;

    const immI = i >> 20;
    const immS = ((i >> 25) << 5) | ((i >>> 7) & 0x1F);
    const immB = ((i >> 31) << 12)
               | (((i >>> 7)  & 0x01) << 11)
               | (((i >>> 25) & 0x3F) << 5)
               | (((i >>> 8)  & 0x0F) << 1);
    const immU = i & 0xFFFFF000;
    const immJ = ((i >> 31) << 20)
               | (((i >>> 12) & 0xFF)  << 12)
               | (((i >>> 20) & 0x01)  << 11)
               | (((i >>> 21) & 0x3FF) << 1);

    const x = this.x;
    const a = x[rs1] | 0;
    const b = x[rs2] | 0;
    let pcNext = (this.pc + 4) >>> 0;

    switch (op) {
      case 0x37: // LUI
        x[rd] = immU | 0;
        break;
      case 0x17: // AUIPC
        x[rd] = (this.pc + immU) | 0;
        break;
      case 0x6F: { // JAL
        x[rd] = pcNext | 0;
        pcNext = (this.pc + immJ) >>> 0;
        break;
      }
      case 0x67: { // JALR
        const t = pcNext | 0;
        pcNext = (a + immI) & ~1;
        x[rd] = t;
        break;
      }
      case 0x63: { // BRANCH
        let take = false;
        switch (f3) {
          case 0: take = (a === b); break;          // beq
          case 1: take = (a !== b); break;          // bne
          case 4: take = (a < b); break;            // blt
          case 5: take = (a >= b); break;           // bge
          case 6: take = ((a >>> 0) < (b >>> 0)); break;  // bltu
          case 7: take = ((a >>> 0) >= (b >>> 0)); break; // bgeu
        }
        if (take) pcNext = (this.pc + immB) >>> 0;
        break;
      }
      case 0x03: { // LOAD
        const addr = (a + immI) >>> 0;
        switch (f3) {
          case 0: x[rd] = signExtend(this.mem.readU8(addr), 8) | 0; break;   // lb
          case 1: x[rd] = signExtend(this.mem.readU16(addr), 16) | 0; break; // lh
          case 2: x[rd] = this.mem.readU32(addr) | 0; break;                  // lw
          case 4: x[rd] = this.mem.readU8(addr) | 0; break;                   // lbu
          case 5: x[rd] = this.mem.readU16(addr) | 0; break;                  // lhu
        }
        break;
      }
      case 0x23: { // STORE
        const addr = (a + immS) >>> 0;
        switch (f3) {
          case 0: this.mem.writeU8(addr, b); break;
          case 1: this.mem.writeU16(addr, b); break;
          case 2: this.mem.writeU32(addr, b); break;
        }
        break;
      }
      case 0x13: { // OP-IMM
        switch (f3) {
          case 0: x[rd] = (a + immI) | 0; break;                            // addi
          case 1: x[rd] = (a << (rs2 & 0x1F)) | 0; break;                   // slli
          case 2: x[rd] = (a < immI) ? 1 : 0; break;                        // slti
          case 3: x[rd] = ((a >>> 0) < (immI >>> 0)) ? 1 : 0; break;        // sltiu
          case 4: x[rd] = (a ^ immI) | 0; break;                            // xori
          case 5:
            if (f7 === 0x20) x[rd] = (a >> (rs2 & 0x1F)) | 0;              // srai
            else             x[rd] = (a >>> (rs2 & 0x1F)) | 0;              // srli
            break;
          case 6: x[rd] = (a | immI) | 0; break;                            // ori
          case 7: x[rd] = (a & immI) | 0; break;                            // andi
        }
        break;
      }
      case 0x33: { // OP
        if (f7 === 0x01) {
          // RV32M
          switch (f3) {
            case 0: x[rd] = Math.imul(a, b) | 0; break;                                   // mul
            case 1: {                                                                      // mulh (signed×signed)
              const hi = Number((BigInt(a) * BigInt(b)) >> 32n);
              x[rd] = hi | 0;
              break;
            }
            case 2: {                                                                      // mulhsu (signed×unsigned)
              const hi = Number((BigInt(a) * BigInt(b >>> 0)) >> 32n);
              x[rd] = hi | 0;
              break;
            }
            case 3: {                                                                      // mulhu (unsigned×unsigned)
              const hi = Number((BigInt(a >>> 0) * BigInt(b >>> 0)) >> 32n);
              x[rd] = hi | 0;
              break;
            }
            case 4: {                                                                      // div
              if (b === 0) x[rd] = -1;
              else if (a === -2147483648 && b === -1) x[rd] = -2147483648;
              else x[rd] = (a / b) | 0;
              break;
            }
            case 5: {                                                                      // divu
              if (b === 0) x[rd] = -1;
              else x[rd] = ((a >>> 0) / (b >>> 0)) | 0;
              break;
            }
            case 6: {                                                                      // rem
              if (b === 0) x[rd] = a;
              else if (a === -2147483648 && b === -1) x[rd] = 0;
              else x[rd] = (a - ((a / b) | 0) * b) | 0;
              break;
            }
            case 7: {                                                                      // remu
              if (b === 0) x[rd] = a;
              else x[rd] = ((a >>> 0) - (((a >>> 0) / (b >>> 0)) | 0) * (b >>> 0)) | 0;
              break;
            }
          }
        } else {
          switch (f3) {
            case 0:
              x[rd] = (f7 === 0x20) ? ((a - b) | 0) : ((a + b) | 0);  // sub / add
              break;
            case 1: x[rd] = (a << (b & 0x1F)) | 0; break;             // sll
            case 2: x[rd] = (a < b) ? 1 : 0; break;                   // slt
            case 3: x[rd] = ((a >>> 0) < (b >>> 0)) ? 1 : 0; break;   // sltu
            case 4: x[rd] = (a ^ b) | 0; break;                       // xor
            case 5:
              x[rd] = (f7 === 0x20) ? ((a >> (b & 0x1F)) | 0)
                                    : ((a >>> (b & 0x1F)) | 0);       // sra / srl
              break;
            case 6: x[rd] = (a | b) | 0; break;                       // or
            case 7: x[rd] = (a & b) | 0; break;                       // and
          }
        }
        break;
      }
      case 0x0F: // FENCE — no-op for a single-threaded model
        break;
      case 0x73: { // SYSTEM
        const imm = (i >>> 20) & 0xFFF;
        if (f3 === 0) {
          if (imm === 0) {
            this.lastEvent = { kind: 'ecall', pc: this.pc };
            this.halted = true;
            this.haltReason = 'ecall';
          } else if (imm === 1) {
            this.lastEvent = { kind: 'ebreak', pc: this.pc };
            this.halted = true;
            this.haltReason = 'ebreak';
          }
          // mret/sret/uret/wfi — treat as no-op halts for v1.
          else {
            this.halted = true;
            this.haltReason = `system imm=0x${imm.toString(16)}`;
          }
        }
        // CSRs — minimal: ignore (return 0). Real CSR table is Phase 2.
        else {
          x[rd] = 0;
        }
        break;
      }
      case 0x2F: {
        // RV32A — minimal stub. Load-reserved/store-conditional behave as
        // plain word load/store; AMOs do load + op + store.
        const addr = a >>> 0;
        const f5 = (i >>> 27) & 0x1F;
        const v = this.mem.readU32(addr) | 0;
        x[rd] = v;
        let nv = v;
        switch (f5) {
          case 0x00: nv = (v + b) | 0; this.mem.writeU32(addr, nv); break;
          case 0x01: this.mem.writeU32(addr, b); break;               // amoswap
          case 0x04: nv = (v ^ b) | 0; this.mem.writeU32(addr, nv); break;
          case 0x08: nv = (v | b) | 0; this.mem.writeU32(addr, nv); break;
          case 0x0C: nv = (v & b) | 0; this.mem.writeU32(addr, nv); break;
          case 0x10: nv = (v < b ? v : b) | 0; this.mem.writeU32(addr, nv); break;
          case 0x14: nv = (v > b ? v : b) | 0; this.mem.writeU32(addr, nv); break;
          case 0x18: nv = ((v >>> 0) < (b >>> 0) ? v : b) | 0; this.mem.writeU32(addr, nv); break;
          case 0x1C: nv = ((v >>> 0) > (b >>> 0) ? v : b) | 0; this.mem.writeU32(addr, nv); break;
          case 0x02: /* lr.w — already read */ break;
          case 0x03: this.mem.writeU32(addr, b); x[rd] = 0; break;
        }
        break;
      }
      default:
        this.halted = true;
        this.haltReason = `illegal opcode 0x${op.toString(16)} at 0x${this.pc.toString(16)}`;
        break;
    }

    return pcNext;
  }
}
