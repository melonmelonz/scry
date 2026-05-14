// GAME pane — runs a GBA cartridge in the browser via the vendored gbajs2
// emulator (BSD-2, endrift + andychase). Penn's split-pane vision: the
// emulator paints on the left, and the same workbench's HEX inspector
// sits on the right so you can pause the game and scroll the ROM bytes.
//
// gbajs2 registers itself as `window.GameBoyAdvance` (classic script,
// not an ES module) and also ships `window.biosBin` — the HLE BIOS as a
// pre-decoded ArrayBuffer — so we boot synchronously without a fetch.

import { fileStore } from '../stores/file.js';
import { el, replaceChildren } from '../dom.js';
import { createHex } from './hex.js';

// gbajs2's indirectCanvas path scales the 240x160 framebuffer up via
// drawImage to whatever the visible canvas's intrinsic `width`/`height`
// attributes are. We render at 2x so the panel reads from a classroom.
const CANVAS_W = 480;
const CANVAS_H = 320;

function hex2(n) { return (n >>> 0).toString(16).padStart(2, '0').toUpperCase(); }

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

// Compact cartridge-header summary that hangs above the hex inspector.
function buildHeader(bytes) {
  const title  = readAsciiZ(bytes, 0xA0, 12);
  const code   = readAsciiZ(bytes, 0xAC, 4);
  const fixed  = bytes[0xB2];
  const ok     = fixed === 0x96;

  return el('div', { class: 'game-cart-head' }, [
    el('span', { class: 'k', text: 'CART' }),
    el('span', { class: 'v', text: `"${title || '(blank)'}"` }),
    el('span', { class: 'k', text: 'CODE' }),
    el('span', { class: 'v', text: code || '----' }),
    el('span', { class: 'k', text: 'FIXED' }),
    el('span', { class: 'v', text: '0x' + hex2(fixed) + (ok ? ' OK' : ' BAD') }),
    el('span', { class: 'k', text: 'SIZE' }),
    el('span', { class: 'v', text: fmtBytes(bytes.byteLength) }),
  ]);
}

export function createGame() {
  const host = document.createElement('section');
  host.className = 's-game';

  let gba = null;
  let currentBytes = null;
  let running = false;
  let bootArmed = false;

  // ---- left pane: emulator canvas + controls -----------------------------
  const canvas = el('canvas', { class: 'game-canvas' });
  // Intrinsic canvas size; gbajs2's drawCallback scales 240x160 → these
  // dimensions, regardless of where (or whether) the canvas is in the DOM.
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  // Focusable so arrow-keys go to the emulator instead of scrolling the page.
  canvas.tabIndex = 0;

  const status   = el('span',   { class: 'game-status', text: 'idle' });
  const playBtn  = el('button', { class: 'game-btn',    text: 'PLAY'  });
  const pauseBtn = el('button', { class: 'game-btn',    text: 'PAUSE' });
  const resetBtn = el('button', { class: 'game-btn',    text: 'RESET' });

  const left = el('div', { class: 'game-left' }, [
    el('div', { class: 'game-bar' }, [
      el('span', { class: 'game-title', text: '[ GBA / EMULATOR ]' }),
      el('span', { class: 'game-hint',  text: 'arrows = D-pad \u00B7 Z/X = A/B \u00B7 Enter = Start' }),
    ]),
    el('div', { class: 'game-canvas-wrap' }, [canvas]),
    el('div', { class: 'game-controls' }, [playBtn, pauseBtn, resetBtn, status]),
  ]);

  // ---- right pane: cartridge header + full HEX inspector -----------------
  // createHex() subscribes to fileStore itself, so the hex view tracks the
  // *same* bytes the emulator is running. Pause the game, scroll any
  // offset, click a section in INSPECT — the hex on the right follows.
  const cartHead = el('div', { class: 'game-cart-head-wrap' });
  const hexHost  = createHex();
  hexHost.classList.add('game-hex-embed');

  const right = el('div', { class: 'game-right' }, [
    el('div', { class: 'game-bar' }, [
      el('span', { class: 'game-title', text: '[ ROM / INSPECTOR ]' }),
      el('span', { class: 'game-hint',  text: 'pause \u00B7 scroll \u00B7 hover bytes' }),
    ]),
    cartHead,
    hexHost,
  ]);

  const split = el('div', { class: 'game-split' }, [left, right]);
  host.appendChild(split);

  function setStatus(t) { status.textContent = t; }

  function ensureGba() {
    if (gba) return gba;
    if (typeof window.GameBoyAdvance !== 'function') {
      throw new Error('gbajs not loaded');
    }
    if (!window.biosBin) {
      throw new Error('biosBin not loaded');
    }
    gba = new window.GameBoyAdvance();
    gba.keypad.eatInput = true;
    gba.logLevel = gba.LOG_ERROR;
    gba.setLogger((level, msg) => {
      // Surface emulator errors in the status line rather than swallowing.
      console.warn('[scry/game/gba]', msg);
    });
    gba.setCanvas(canvas);
    gba.setBios(window.biosBin);
    return gba;
  }

  function loadCart(bytes) {
    setStatus('loading\u2026');
    try {
      const inst = ensureGba();
      // gbajs2.setRom expects an ArrayBuffer. Slice handles the case where
      // the file store handed us a Uint8Array view into a larger buffer.
      const rom = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      );
      const ok = inst.setRom(rom);
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
    // Re-loading the ROM calls reset() internally and re-arms the MMU/regs.
    const wasRunning = running;
    pause();
    loadCart(currentBytes);
    if (wasRunning) play();
  }

  playBtn.addEventListener('click', play);
  pauseBtn.addEventListener('click', pause);
  resetBtn.addEventListener('click', reset);

  // React to file changes. The subscribe callback fires synchronously the
  // first time with whatever bytes are already in the store, so we defer
  // the actual emulator boot to the next rAF — by then the host has been
  // appended to the DOM and the canvas has real layout dimensions.
  fileStore.subscribe(state => {
    const bytes = state.bytes;
    if (gba && running) pause();
    if (!bytes) {
      currentBytes = null;
      replaceChildren(cartHead, []);
      setStatus('idle');
      return;
    }
    // Defensive — main.js's router gates the tab, but this module may
    // still be mounted in the DOM when a non-GBA file is selected.
    if (bytes.byteLength < 0xC0 || bytes[0xB2] !== 0x96) {
      currentBytes = null;
      replaceChildren(cartHead, []);
      setStatus('not a GBA cart');
      return;
    }
    currentBytes = bytes;
    replaceChildren(cartHead, [buildHeader(bytes)]);
    if (bootArmed) {
      loadCart(bytes);
    } else {
      bootArmed = true;
      requestAnimationFrame(() => loadCart(bytes));
    }
  });

  return host;
}
