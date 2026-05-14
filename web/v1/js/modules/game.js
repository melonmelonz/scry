// GAME pane — runs a GBA cartridge in the browser via the vendored gbajs
// emulator (BSD-2, endrift). Penn's split-pane vision: emulator on the
// left, header overview + a window of ROM hex on the right, so you can
// watch the game render *and* see the bytes that produced it.
//
// gbajs registers itself as a global (`window.GameBoyAdvance`) because
// it predates ES modules — see vendor/gbajs/NOTICE.md.

import { fileStore } from '../stores/file.js';
import { el, replaceChildren } from '../dom.js';

const BIOS_URL = 'vendor/gbajs/resources/bios.bin';

// Native GBA resolution. We render at 2x so the panel reads from across
// a classroom but the canvas stays pixel-perfect.
const GBA_W = 240;
const GBA_H = 160;

function hex2(n) { return (n >>> 0).toString(16).padStart(2, '0').toUpperCase(); }
function hex8(n) { return '0x' + (n >>> 0).toString(16).padStart(8, '0').toUpperCase(); }
function asciiCh(n) { return (n >= 0x20 && n <= 0x7E) ? String.fromCharCode(n) : '.'; }

function readAsciiZ(bytes, off, len) {
  let s = '';
  for (let i = 0; i < len; i++) {
    const b = bytes[off + i];
    if (b === 0) break;
    s += (b >= 0x20 && b <= 0x7E) ? String.fromCharCode(b) : '.';
  }
  return s.trim();
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}

// Render a 16-byte hex/ASCII row at a given file offset.
function buildRow(bytes, rowOff) {
  const slice = bytes.subarray(rowOff, Math.min(bytes.length, rowOff + 16));
  const hexs = [];
  const asc = [];
  for (let i = 0; i < slice.length; i++) {
    hexs.push(hex2(slice[i]));
    asc.push(asciiCh(slice[i]));
    if (i === 7) hexs.push(' ');
  }
  return el('div', { class: 'game-hex-row' }, [
    el('span', { class: 'addr', text: hex8(rowOff) }),
    el('span', { class: 'bytes', text: hexs.join(' ') }),
    el('span', { class: 'ascii', text: asc.join('') })
  ]);
}

// Build the right-hand panel: title row, key header fields, then ROM hex.
function buildInspector(bytes) {
  const title  = readAsciiZ(bytes, 0xA0, 12);
  const code   = readAsciiZ(bytes, 0xAC, 4);
  const maker  = readAsciiZ(bytes, 0xB0, 2);
  const fixed  = bytes[0xB2];
  const ver    = bytes[0xBC];
  const csum   = bytes[0xBD];

  const meta = el('div', { class: 'game-meta' }, [
    el('div', { class: 'game-meta-row' }, [
      el('span', { class: 'l', text: 'TITLE' }),
      el('span', { class: 'v', text: title || '(blank)' })
    ]),
    el('div', { class: 'game-meta-row' }, [
      el('span', { class: 'l', text: 'CODE' }),
      el('span', { class: 'v', text: code || '----' })
    ]),
    el('div', { class: 'game-meta-row' }, [
      el('span', { class: 'l', text: 'MAKER' }),
      el('span', { class: 'v', text: maker || '--' })
    ]),
    el('div', { class: 'game-meta-row' }, [
      el('span', { class: 'l', text: 'FIXED' }),
      el('span', { class: 'v', text: '0x' + hex2(fixed) + (fixed === 0x96 ? '  \u2713' : '  \u2717') })
    ]),
    el('div', { class: 'game-meta-row' }, [
      el('span', { class: 'l', text: 'VERSION' }),
      el('span', { class: 'v', text: '0x' + hex2(ver) })
    ]),
    el('div', { class: 'game-meta-row' }, [
      el('span', { class: 'l', text: 'CHECKSUM' }),
      el('span', { class: 'v', text: '0x' + hex2(csum) })
    ]),
    el('div', { class: 'game-meta-row' }, [
      el('span', { class: 'l', text: 'SIZE' }),
      el('span', { class: 'v', text: fmtBytes(bytes.byteLength) })
    ]),
  ]);

  // First 4 rows of the cartridge header — the bytes the emulator just
  // parsed to know what to do.
  const rows = [];
  for (let off = 0xA0; off < 0xE0; off += 16) {
    rows.push(buildRow(bytes, off));
  }
  const hexWin = el('div', { class: 'game-hex' }, rows);

  return el('div', { class: 'game-inspector' }, [
    el('div', { class: 'game-inspector-title', text: '[ CARTRIDGE HEADER ]' }),
    meta,
    el('div', { class: 'game-inspector-title', text: '[ HEADER BYTES 0xA0\u20130xDF ]' }),
    hexWin,
  ]);
}

// Module factory. Returns the host element. Internally owns one
// GameBoyAdvance instance and re-uses it across file loads.
export function createGame() {
  const host = document.createElement('section');
  host.className = 's-game';

  let gba = null;
  let biosBuffer = null;
  let biosPromise = null;
  let currentBytes = null;
  let running = false;
  let statusText = 'idle';

  // Pane scaffold.
  const canvas = el('canvas', { class: 'game-canvas' });
  canvas.width = GBA_W;
  canvas.height = GBA_H;
  // Focusable so arrow-keys go to the emulator instead of scrolling the page.
  canvas.tabIndex = 0;

  const status = el('span', { class: 'game-status', text: statusText });
  const playBtn  = el('button', { class: 'game-btn',  text: 'PLAY'  });
  const pauseBtn = el('button', { class: 'game-btn',  text: 'PAUSE' });
  const resetBtn = el('button', { class: 'game-btn',  text: 'RESET' });

  const controls = el('div', { class: 'game-controls' }, [playBtn, pauseBtn, resetBtn, status]);

  const left = el('div', { class: 'game-left' }, [
    el('div', { class: 'game-bar' }, [
      el('span', { class: 'game-title', text: '[ GBA / EMULATOR ]' }),
      el('span', { class: 'game-hint',  text: 'arrows = D-pad \u00B7 Z/X = A/B \u00B7 Enter = Start' }),
    ]),
    el('div', { class: 'game-canvas-wrap' }, [canvas]),
    controls,
  ]);

  const right = el('div', { class: 'game-right', text: '' });
  // Empty placeholder until a cart is loaded.

  const split = el('div', { class: 'game-split' }, [left, right]);
  host.appendChild(split);

  function setStatus(t) {
    statusText = t;
    status.textContent = t;
  }

  async function loadBios() {
    if (biosBuffer) return biosBuffer;
    if (biosPromise) return biosPromise;
    biosPromise = fetch(BIOS_URL)
      .then(r => {
        if (!r.ok) throw new Error('BIOS fetch failed: ' + r.status);
        return r.arrayBuffer();
      })
      .then(buf => { biosBuffer = buf; return buf; });
    return biosPromise;
  }

  function ensureGba() {
    if (gba) return gba;
    if (typeof window.GameBoyAdvance !== 'function') {
      throw new Error('gbajs not loaded');
    }
    gba = new window.GameBoyAdvance();
    gba.keypad.eatInput = true;
    gba.logLevel = gba.LOG_ERROR;
    gba.setCanvas(canvas);
    return gba;
  }

  async function loadCart(bytes) {
    setStatus('loading\u2026');
    try {
      const inst = ensureGba();
      const bios = await loadBios();
      inst.setBios(bios);
      // gbajs.setRom expects an ArrayBuffer; the Uint8Array `.buffer`
      // backing the file store is exactly that.
      const ok = inst.setRom(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      if (!ok) {
        setStatus('rom rejected');
        return;
      }
      setStatus('paused');
      running = false;
    } catch (e) {
      console.error('[scry/game] load failed', e);
      setStatus('error: ' + (e?.message || e));
    }
  }

  function play() {
    if (!gba || !gba.hasRom()) return;
    if (running) return;
    canvas.focus();
    gba.runStable();
    running = true;
    setStatus('running');
  }

  function pause() {
    if (!gba || !gba.hasRom()) return;
    gba.pause();
    running = false;
    setStatus('paused');
  }

  function reset() {
    if (!gba || !currentBytes) return;
    // Easiest reliable "reset" against gbajs is to re-load the ROM,
    // which calls reset() internally and re-arms the MMU/regs.
    const wasRunning = running;
    pause();
    loadCart(currentBytes).then(() => { if (wasRunning) play(); });
  }

  playBtn.addEventListener('click', play);
  pauseBtn.addEventListener('click', pause);
  resetBtn.addEventListener('click', reset);

  function render() {
    if (!currentBytes) {
      replaceChildren(right, [
        el('div', { class: 'game-empty', text: 'Load a GBA cartridge to inspect its header.' })
      ]);
      return;
    }
    replaceChildren(right, [buildInspector(currentBytes)]);
  }

  // React to file changes: pause anything running, swap the cart, redraw
  // the inspector. Don't auto-start; the user clicks PLAY.
  fileStore.subscribe(state => {
    const bytes = state.bytes;
    if (gba && running) pause();
    if (!bytes) {
      currentBytes = null;
      render();
      setStatus('idle');
      return;
    }
    // Only react if this is a GBA cart; defensive — main.js's router
    // gates the tab, but this module may still be mounted in the DOM.
    if (bytes.byteLength < 0xC0 || bytes[0xB2] !== 0x96) {
      currentBytes = null;
      render();
      setStatus('not a GBA cart');
      return;
    }
    currentBytes = bytes;
    render();
    loadCart(bytes);
  });

  render();
  return host;
}
