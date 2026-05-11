// Hand-assembled RV32 demo program wrapped in a minimal ELF.
//
// The program exercises the emulator's MMIO peripherals so the Trace module
// has live transactions to decode without the user supplying their own
// firmware. Sequence:
//
//   SPI flash JEDEC ID read:
//     CS=0, TX=0x9F, RX, TX=0x00, RX, CS=1
//
//   I2C EEPROM byte read at device 0x50, register 0x00:
//     START, addr|W (0xA0), reg (0x00), RESTART, addr|R (0xA1), data, STOP
//
//   ecall   -- halt
//
// Instruction encodings were hand-derived against the RV32I spec; see the
// comments next to each word for the source-form mnemonic. Entry point is
// 0x00010000 (matches p_vaddr).

const TEXT = new Uint32Array([
  0x100002B7,  // lui   t0, 0x10000           ; t0 = 0x10000000 (SPI base)
  0x0002A823,  // sw    zero, 16(t0)          ; CS low
  0x09F00513,  // addi  a0, zero, 0x9F        ; JEDEC ID cmd
  0x00A2A423,  // sw    a0, 8(t0)             ; TX 0x9F
  0x00C2A583,  // lw    a1, 12(t0)            ; RX byte 1
  0x0002A423,  // sw    zero, 8(t0)           ; TX dummy
  0x00C2A603,  // lw    a2, 12(t0)            ; RX byte 2
  0x00100693,  // addi  a3, zero, 1
  0x00D2A823,  // sw    a3, 16(t0)            ; CS high
  0x10028313,  // addi  t1, t0, 0x100         ; t1 = 0x10000100 (I2C base)
  0x00100713,  // addi  a4, zero, 1
  0x00E32023,  // sw    a4, 0(t1)             ; I2C START
  0x0A000793,  // addi  a5, zero, 0xA0        ; (0x50<<1) | 0  (addr+W)
  0x00F32423,  // sw    a5, 8(t1)             ; send addr+W
  0x00032423,  // sw    zero, 8(t1)           ; send register 0x00
  0x00400813,  // addi  a6, zero, 4
  0x01032023,  // sw    a6, 0(t1)             ; I2C RESTART
  0x0A100893,  // addi  a7, zero, 0xA1        ; (0x50<<1) | 1  (addr+R)
  0x01132423,  // sw    a7, 8(t1)             ; send addr+R
  0x00832403,  // lw    s0, 8(t1)             ; read data byte
  0x00200493,  // addi  s1, zero, 2
  0x00932023,  // sw    s1, 0(t1)             ; I2C STOP
  0x00000073   // ecall                       ; halt
]);

const ENTRY = 0x00010000;
const TEXT_BYTES = TEXT.length * 4;

export function buildDemoElf() {
  const phoff = 52;
  const text_off = 84;
  const total = text_off + TEXT_BYTES;

  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);

  // e_ident
  u8[0] = 0x7F; u8[1] = 0x45; u8[2] = 0x4C; u8[3] = 0x46; // \x7FELF
  u8[4] = 1;    // EI_CLASS = ELFCLASS32
  u8[5] = 1;    // EI_DATA  = ELFDATA2LSB
  u8[6] = 1;    // EI_VERSION
  // u8[7..15] left zero

  // Little-endian header writes.
  dv.setUint16(16, 2,         true); // e_type = ET_EXEC
  dv.setUint16(18, 0xF3,      true); // e_machine = EM_RISCV (243)
  dv.setUint32(20, 1,         true); // e_version
  dv.setUint32(24, ENTRY,     true); // e_entry
  dv.setUint32(28, phoff,     true); // e_phoff
  dv.setUint32(32, 0,         true); // e_shoff
  dv.setUint32(36, 0,         true); // e_flags
  dv.setUint16(40, 52,        true); // e_ehsize
  dv.setUint16(42, 32,        true); // e_phentsize
  dv.setUint16(44, 1,         true); // e_phnum
  dv.setUint16(46, 0,         true); // e_shentsize
  dv.setUint16(48, 0,         true); // e_shnum
  dv.setUint16(50, 0,         true); // e_shstrndx

  // Program header @ phoff
  dv.setUint32(phoff + 0,  1,           true); // p_type = PT_LOAD
  dv.setUint32(phoff + 4,  text_off,    true); // p_offset
  dv.setUint32(phoff + 8,  ENTRY,       true); // p_vaddr
  dv.setUint32(phoff + 12, ENTRY,       true); // p_paddr
  dv.setUint32(phoff + 16, TEXT_BYTES,  true); // p_filesz
  dv.setUint32(phoff + 20, TEXT_BYTES,  true); // p_memsz
  dv.setUint32(phoff + 24, 5,           true); // p_flags = PF_R | PF_X
  dv.setUint32(phoff + 28, 0x1000,      true); // p_align

  // Code @ text_off (little-endian instructions)
  for (let i = 0; i < TEXT.length; i++) {
    dv.setUint32(text_off + i * 4, TEXT[i], true);
  }

  return new Uint8Array(buf);
}

export const DEMO_NAME = 'demo-rv32-spi-i2c.elf';
