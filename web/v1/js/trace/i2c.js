// I²C transaction decoder. Mirrors the SPI controller convention but uses
// the start/stop/restart semantics of the bus.
//
// Register layout (relative to I2C_BASE):
//   +0x00  CTRL   — bit0 = start (S), bit1 = stop (P), bit2 = restart (Sr)
//   +0x04  STATUS — bit0 = ack received
//   +0x08  DATA   — write = TX byte; read = RX byte after a transfer
//
// On START the next DATA write is treated as the address+R/W byte (7-bit
// address in [7:1], R/W in bit0). Subsequent DATA writes are payload until
// STOP or RESTART.

export const I2C_BASE = 0x10000100;

const REG_CTRL   = 0x00;
const REG_DATA   = 0x08;

const CTRL_START   = 0x01;
const CTRL_STOP    = 0x02;
const CTRL_RESTART = 0x04;

export function createI2cDecoder(base = I2C_BASE) {
  let active = false;
  let expectAddr = false;
  let openTxn = null;
  const transactions = [];

  function finalize(endCycle) {
    if (openTxn) {
      openTxn.end_cycle = endCycle ?? openTxn.end_cycle;
      transactions.push(openTxn);
    }
    openTxn = null;
  }

  function feed(ev) {
    if (ev.kind !== 'mmio.write' && ev.kind !== 'mmio.read') return;
    const offset = (ev.addr - base) >>> 0;
    if (offset > 0x08) return;

    if (offset === REG_CTRL && ev.kind === 'mmio.write') {
      const v = ev.value | 0;
      if (v & CTRL_START) {
        active = true;
        expectAddr = true;
        openTxn = {
          start_cycle: ev.cycle ?? 0,
          end_cycle: ev.cycle ?? 0,
          address: null,
          direction: null,   // 'r' or 'w'
          bytes: []
        };
      } else if (v & CTRL_RESTART) {
        finalize(ev.cycle);
        active = true;
        expectAddr = true;
        openTxn = {
          start_cycle: ev.cycle ?? 0,
          end_cycle: ev.cycle ?? 0,
          address: null,
          direction: null,
          bytes: [],
          restart: true
        };
      } else if (v & CTRL_STOP) {
        finalize(ev.cycle);
        active = false;
        expectAddr = false;
      }
      return;
    }

    if (offset === REG_DATA) {
      if (!active || !openTxn) return;
      if (ev.kind === 'mmio.write') {
        if (expectAddr) {
          openTxn.address = (ev.value >>> 1) & 0x7F;
          openTxn.direction = (ev.value & 1) ? 'r' : 'w';
          expectAddr = false;
        } else if (openTxn.direction === 'w') {
          openTxn.bytes.push(ev.value & 0xFF);
        }
        openTxn.end_cycle = ev.cycle ?? openTxn.end_cycle;
      } else if (ev.kind === 'mmio.read') {
        if (openTxn.direction === 'r') {
          openTxn.bytes.push(ev.value & 0xFF);
          openTxn.end_cycle = ev.cycle ?? openTxn.end_cycle;
        }
      }
    }
  }

  function reset() {
    active = false;
    expectAddr = false;
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
