// SPI transaction decoder for Scry v1.
//
// The emulator's MMIO window includes a simple SPI controller at a fixed
// register layout. Whenever the firmware writes to TX while CS is low we
// treat it as one byte of a transaction; CS rising terminates the
// transaction and emits a record.
//
// Register layout (relative to the SPI base):
//   +0x00  CTRL    — bit0 = start (write-1 to begin), mode in bits[2:1]
//   +0x04  STATUS  — bit0 = done (firmware polls)
//   +0x08  TX      — write to push a MOSI byte
//   +0x0C  RX      — read returns the most recent MISO byte
//   +0x10  CS      — bit0 = 0 selects the device, bit0 = 1 deselects
//
// The decoder is stateful — feed it events in order with feed(event).

export const SPI_BASE = 0x10000000;

const REG_CTRL   = 0x00;
const REG_STATUS = 0x04;
const REG_TX     = 0x08;
const REG_RX     = 0x0C;
const REG_CS     = 0x10;

export function createSpiDecoder(base = SPI_BASE) {
  let csLow = false;            // current CS state (true = selected)
  let openTxn = null;           // accumulating transaction, or null
  const transactions = [];

  function feed(ev) {
    if (ev.kind !== 'mmio.write' && ev.kind !== 'mmio.read') return;
    const offset = (ev.addr - base) >>> 0;
    if (offset >= 0x14) return;

    switch (offset) {
      case REG_CS: {
        if (ev.kind !== 'mmio.write') return;
        const nowLow = (ev.value & 1) === 0;
        if (nowLow && !csLow) {
          openTxn = {
            start_cycle: ev.cycle ?? 0,
            end_cycle: ev.cycle ?? 0,
            mosi: [],
            miso: []
          };
        } else if (!nowLow && csLow && openTxn) {
          openTxn.end_cycle = ev.cycle ?? openTxn.start_cycle;
          transactions.push(openTxn);
          openTxn = null;
        }
        csLow = nowLow;
        return;
      }
      case REG_TX: {
        if (ev.kind !== 'mmio.write') return;
        if (openTxn) {
          openTxn.mosi.push(ev.value & 0xFF);
          openTxn.end_cycle = ev.cycle ?? openTxn.end_cycle;
        }
        return;
      }
      case REG_RX: {
        if (ev.kind !== 'mmio.read') return;
        if (openTxn) {
          openTxn.miso.push(ev.value & 0xFF);
        }
        return;
      }
      default:
        return;
    }
  }

  function reset() {
    csLow = false;
    openTxn = null;
    transactions.length = 0;
  }

  return {
    feed,
    reset,
    get transactions() { return transactions; },
    get pending() { return openTxn; }
  };
}
