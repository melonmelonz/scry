const CART_WINDOW_SIZE = 0x02000000;

const REGIONS = [
  { start: 0x00000000, end: 0x00004000, label: 'BIOS' },
  { start: 0x02000000, end: 0x02040000, label: 'EWRAM' },
  { start: 0x03000000, end: 0x03008000, label: 'IWRAM' },
  { start: 0x04000000, end: 0x04000400, label: 'I/O' },
  { start: 0x05000000, end: 0x05000400, label: 'PAL' },
  { start: 0x06000000, end: 0x06018000, label: 'VRAM' },
  { start: 0x07000000, end: 0x07000400, label: 'OAM' },
  { start: 0x0E000000, end: 0x0E010000, label: 'SRAM' },
];

const CART_WINDOWS = [
  { start: 0x08000000, label: 'ROM0' },
  { start: 0x0A000000, label: 'ROM1' },
  { start: 0x0C000000, label: 'ROM2' },
];

export function describeGbaAddress(address, romSize = 0) {
  const addr = address >>> 0;
  for (const cart of CART_WINDOWS) {
    const rawOffset = addr - cart.start;
    if (rawOffset >= 0 && rawOffset < CART_WINDOW_SIZE) {
      if (romSize > 0) {
        return {
          address: addr,
          label: cart.label,
          inCart: true,
          offset: rawOffset % romSize,
          rawOffset,
          mirrored: rawOffset >= romSize,
        };
      }
      return { address: addr, label: cart.label, inCart: false, offset: null, rawOffset, mirrored: false };
    }
  }
  for (const r of REGIONS) {
    if (addr >= r.start && addr < r.end) {
      return { address: addr, label: r.label, inCart: false, offset: null, rawOffset: addr - r.start, mirrored: false };
    }
  }
  return { address: addr, label: 'BUS', inCart: false, offset: null, rawOffset: null, mirrored: false };
}

export function currentGbaPc(cpu) {
  const pc = cpu?.gprs?.[15];
  if (typeof pc !== 'number') return null;
  const width = Number(cpu?.instructionWidth) || 4;
  return ((pc >>> 0) - width) >>> 0;
}

export function currentGbaMode(cpu) {
  return cpu?.execMode === cpu?.MODE_THUMB ? 'THUMB' : 'ARM';
}
