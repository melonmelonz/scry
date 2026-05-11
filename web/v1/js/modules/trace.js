import { el } from '../dom.js';
import { busLog } from '../stores/bus.js';
import { createSpiDecoder, SPI_BASE } from '../trace/spi.js';
import { createI2cDecoder, I2C_BASE } from '../trace/i2c.js';

// Trace module — reads the shared bus event log (filled by the emulator's
// MMIO writes) and decodes it as SPI / I²C transactions. No external file
// input in v1; the demo loop is firmware -> MMIO -> trace decoders.

function fmtBytes(bytes) {
  if (!bytes.length) return '(empty)';
  return bytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
}

function fmtAddr(a) {
  return '0x' + a.toString(16).padStart(8, '0');
}

export function createTrace() {
  const root = el('div', { class: 't-wrap' });

  const titleEl = el('span', { class: 't-title', text: '[ TRACE / BUS DECODE ]' });
  const metaEl  = el('span', { class: 't-meta', text: '' });
  const bar = el('div', { class: 't-bar' }, [titleEl, metaEl]);
  root.appendChild(bar);

  const note = el('p', {
    class: 't-note',
    text:
      'Synthetic capture: emulator MMIO writes are decoded as SPI ' +
      `(base ${fmtAddr(SPI_BASE)}) and I\u00B2C (base ${fmtAddr(I2C_BASE)}). ` +
      'Run a program in EMU that toggles those registers to see transactions here.'
  });
  root.appendChild(note);

  const body = el('div', { class: 't-body' });
  root.appendChild(body);

  const spiList = el('div', { class: 't-list' });
  const i2cList = el('div', { class: 't-list' });
  const rawList = el('div', { class: 't-list' });

  body.appendChild(el('section', { class: 't-pane' }, [
    el('h2', { class: 't-pane-h', text: 'SPI' }),
    spiList
  ]));
  body.appendChild(el('section', { class: 't-pane' }, [
    el('h2', { class: 't-pane-h', text: 'I\u00B2C' }),
    i2cList
  ]));
  body.appendChild(el('section', { class: 't-pane' }, [
    el('h2', { class: 't-pane-h', text: 'RAW MMIO' }),
    rawList
  ]));

  function renderSpi(txns) {
    spiList.replaceChildren();
    if (!txns.length) {
      spiList.appendChild(el('div', { class: 't-empty', text: 'no transactions' }));
      return;
    }
    for (let i = 0; i < txns.length; i++) {
      const t = txns[i];
      const row = el('div', { class: 't-row' }, [
        el('span', { class: 't-idx', text: String(i).padStart(3, '0') }),
        el('span', { class: 't-cyc', text: `c${t.start_cycle}\u2192c${t.end_cycle}` }),
        el('span', { class: 't-dir', text: 'MOSI' }),
        el('span', { class: 't-data', text: fmtBytes(t.mosi) }),
        el('span', { class: 't-dir', text: 'MISO' }),
        el('span', { class: 't-data muted', text: fmtBytes(t.miso) })
      ]);
      spiList.appendChild(row);
    }
  }

  function renderI2c(txns) {
    i2cList.replaceChildren();
    if (!txns.length) {
      i2cList.appendChild(el('div', { class: 't-empty', text: 'no transactions' }));
      return;
    }
    for (let i = 0; i < txns.length; i++) {
      const t = txns[i];
      const addr = t.address !== null
        ? '0x' + t.address.toString(16).padStart(2, '0')
        : '??';
      const dir = t.direction === 'r' ? 'READ ' : t.direction === 'w' ? 'WRITE' : '---  ';
      const row = el('div', { class: 't-row' }, [
        el('span', { class: 't-idx', text: String(i).padStart(3, '0') }),
        el('span', { class: 't-cyc', text: `c${t.start_cycle}\u2192c${t.end_cycle}` }),
        el('span', { class: 't-dir', text: dir + (t.restart ? ' (Sr)' : '') }),
        el('span', { class: 't-addr', text: addr }),
        el('span', { class: 't-data', text: fmtBytes(t.bytes) })
      ]);
      i2cList.appendChild(row);
    }
  }

  function renderRaw(events) {
    rawList.replaceChildren();
    const tail = events.slice(-200);
    if (!tail.length) {
      rawList.appendChild(el('div', { class: 't-empty', text: 'no MMIO traffic' }));
      return;
    }
    for (let i = 0; i < tail.length; i++) {
      const ev = tail[i];
      const kind = ev.kind === 'mmio.write' ? 'W' : 'R';
      const valHex = '0x' + (ev.value >>> 0).toString(16).padStart(2 * (ev.width || 4), '0');
      const row = el('div', { class: 't-row raw' }, [
        el('span', { class: 't-idx', text: String(events.length - tail.length + i).padStart(4, '0') }),
        el('span', { class: 't-dir ' + (kind === 'W' ? 'w' : 'r'), text: kind }),
        el('span', { class: 't-addr', text: fmtAddr(ev.addr >>> 0) }),
        el('span', { class: 't-data', text: valHex }),
        el('span', { class: 't-width muted', text: `w${ev.width || 4}` })
      ]);
      rawList.appendChild(row);
    }
  }

  function refresh() {
    const events = busLog.events;
    const spi = createSpiDecoder();
    const i2c = createI2cDecoder();
    for (const ev of events) {
      spi.feed(ev);
      i2c.feed(ev);
    }
    metaEl.textContent =
      `${events.length} events / ${spi.transactions.length} SPI / ${i2c.transactions.length} I\u00B2C`;
    renderSpi(spi.transactions);
    renderI2c(i2c.transactions);
    renderRaw(events);
  }

  busLog.subscribe(refresh);
  refresh();

  return root;
}
