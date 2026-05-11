// Flat address space with sparse MMIO handlers. The CPU reads/writes through
// this — anything in an MMIO range is dispatched to its handler; everything
// else lands in the backing ArrayBuffer.

export class Memory {
  constructor(size) {
    this.size = size >>> 0;
    this.buf = new ArrayBuffer(this.size);
    this.u8  = new Uint8Array(this.buf);
    this.dv  = new DataView(this.buf);
    this.mmio = [];   // [{ start, end, read, write }]
    this.bus  = null; // optional event sink for MMIO write/read
  }

  loadAt(addr, bytes) {
    if (addr + bytes.byteLength > this.size) {
      throw new Error(`load 0x${addr.toString(16)}+${bytes.byteLength} exceeds memory size 0x${this.size.toString(16)}`);
    }
    this.u8.set(bytes, addr >>> 0);
  }

  mapMmio(start, end, handlers) {
    this.mmio.push({ start: start >>> 0, end: end >>> 0, ...handlers });
  }

  findMmio(addr) {
    for (const m of this.mmio) {
      if (addr >= m.start && addr < m.end) return m;
    }
    return null;
  }

  readU8(addr) {
    const a = addr >>> 0;
    const m = this.findMmio(a);
    if (m && m.read) return m.read(a, 1) & 0xFF;
    return this.u8[a];
  }
  readU16(addr) {
    const a = addr >>> 0;
    const m = this.findMmio(a);
    if (m && m.read) return m.read(a, 2) & 0xFFFF;
    return this.dv.getUint16(a, true);
  }
  readU32(addr) {
    const a = addr >>> 0;
    const m = this.findMmio(a);
    if (m && m.read) return m.read(a, 4) >>> 0;
    return this.dv.getUint32(a, true);
  }
  writeU8(addr, v) {
    const a = addr >>> 0;
    const m = this.findMmio(a);
    if (m && m.write) { m.write(a, v & 0xFF, 1); return; }
    this.u8[a] = v & 0xFF;
  }
  writeU16(addr, v) {
    const a = addr >>> 0;
    const m = this.findMmio(a);
    if (m && m.write) { m.write(a, v & 0xFFFF, 2); return; }
    this.dv.setUint16(a, v & 0xFFFF, true);
  }
  writeU32(addr, v) {
    const a = addr >>> 0;
    const m = this.findMmio(a);
    if (m && m.write) { m.write(a, v >>> 0, 4); return; }
    this.dv.setUint32(a, v >>> 0, true);
  }
}
