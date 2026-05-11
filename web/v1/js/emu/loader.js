// Map an ELF into a flat Memory and return a CPU bound to it.
import { Memory } from './memory.js';
import { CPU } from './cpu.js';

const DEFAULT_MEM = 16 * 1024 * 1024;   // 16 MiB
const DEFAULT_STACK_TOP = 0x00800000;    // 8 MiB into the address space
const DEFAULT_MMIO_BASE = 0x10000000;
const DEFAULT_MMIO_END  = 0x10001000;

// Build memory + CPU from a parsed ELF. The ELF must be RV32 (e_machine 243).
// Loads LOAD program segments verbatim; if no LOAD segments, falls back to
// laying out PROGBITS sections at their sh_addr.
//
// The supplied `busSink(event)` callback is invoked for every MMIO transaction
// (event = { kind: 'mmio.read'|'mmio.write', addr, value, width, cycle }).
export function loadFromElf(elf, fileBytes, busSink) {
  const mem = new Memory(DEFAULT_MEM);
  let loaded = 0;

  const PT_LOAD = 1;
  const SHT_PROGBITS = 1;
  const SHF_ALLOC = 0x2;

  // Strategy 1 — program headers.
  for (const ph of elf.segments) {
    if (ph.p_type !== PT_LOAD) continue;
    const filesz = Number(ph.p_filesz);
    const memsz = Number(ph.p_memsz);
    const off = Number(ph.p_offset);
    const va = Number(ph.p_vaddr);
    if (va + memsz > mem.size) {
      throw new Error(`segment 0x${va.toString(16)}+${memsz} exceeds emulator memory`);
    }
    if (filesz > 0) {
      mem.loadAt(va, fileBytes.subarray(off, off + filesz));
      loaded += filesz;
    }
    // BSS region (memsz > filesz) is already zero — Memory was zero-init.
  }

  // Strategy 2 — fall back to section headers when no LOAD segments exist.
  if (loaded === 0) {
    for (const s of elf.sections) {
      if (s.sh_type !== SHT_PROGBITS) continue;
      const flags = typeof s.sh_flags === 'bigint' ? Number(s.sh_flags & 0xFFFFFFFFn) : s.sh_flags;
      if (!(flags & SHF_ALLOC)) continue;
      const off = Number(s.sh_offset);
      const sz = Number(s.sh_size);
      const va = Number(s.sh_addr);
      if (va + sz > mem.size) continue;
      mem.loadAt(va, fileBytes.subarray(off, off + sz));
      loaded += sz;
    }
  }

  // MMIO window.
  const peripheralState = {};
  mem.mapMmio(DEFAULT_MMIO_BASE, DEFAULT_MMIO_END, {
    read: (addr, width) => {
      const v = peripheralState[addr] ?? 0;
      if (busSink) busSink({ kind: 'mmio.read', addr, value: v, width });
      return v;
    },
    write: (addr, value, width) => {
      peripheralState[addr] = value;
      if (busSink) busSink({ kind: 'mmio.write', addr, value, width });
    }
  });

  const entry = Number(elf.header.e_entry) >>> 0;
  const cpu = new CPU(mem, entry, DEFAULT_STACK_TOP);
  return { cpu, mem, mmio: { base: DEFAULT_MMIO_BASE, end: DEFAULT_MMIO_END } };
}
