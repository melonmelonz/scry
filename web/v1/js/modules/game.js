// GAME pane — runs a GBA cartridge in the browser via the vendored gbajs2
// emulator (BSD-2). Penn's split-pane vision: the emulator paints on the
// left, a lightweight virtualized hex viewer on the right so you can
// pause the game and scroll the ROM bytes in real time.
//
// We do NOT embed the full HEX module here. The HEX module precomputes
// a Shannon entropy histogram across all bytes on every fileStore tick,
// which for a 16 MiB cartridge is enough work to freeze the main thread
// for several seconds. The viewer below is virtualized but does not do
// any precompute — just rows of bytes, painted on demand.

import { fileStore } from '../stores/file.js';
import { el, replaceChildren } from '../dom.js';

const CANVAS_W = 480;
const CANVAS_H = 320;

const ROW_BYTES = 16;
const ROW_HEIGHT = 20;
const OVERSCAN = 6;

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

function buildCartHead(bytes) {
  const title = readAsciiZ(bytes, 0xA0, 12);
  const code  = readAsciiZ(bytes, 0xAC, 4);
  const fixed = bytes[0xB2];
  return el('div', { class: 'game-cart-head' }, [
    el('span', { class: 'k', text: 'CART' }),
    el('span', { class: 'v', text: `"${title || '(blank)'}"` }),
    el('span', { class: 'k', text: 'CODE' }),
    el('span', { class: 'v', text: code || '----' }),
    el('span', { class: 'k', text: 'FIXED' }),
    el('span', { class: 'v', text: '0x' + hex2(fixed) + (fixed === 0x96 ? ' OK' : ' BAD') }),
    el('span', { class: 'k', text: 'SIZE' }),
    el('span', { class: 'v', text: fmtBytes(bytes.byteLength) }),
  ]);
}

// ─── Lightweight virtualized hex viewer ────────────────────────────────
// Used only inside the GAME pane. Renders only the visible window of
// rows; no entropy compute, no overlays, no field tooltips. Just bytes.
function createMiniHex() {
  const host = el('section', { class: 'game-hex-mini' });

  const titleEl = el('span', { class: 'game-hex-mini-title', text: 'ROM (empty)' });

  const jumpInput = el('input', {
    type: 'text', placeholder: '0x...', class: 'game-hex-mini-jump',
    'aria-label': 'jump to offset',
  });
  const jumpForm = el('form', { class: 'game-hex-mini-jumpform' }, [
    el('span', { class: 'game-hex-mini-jumplab', text: 'JUMP' }),
    jumpInput,
  ]);

  const bar = el('div', { class: 'game-hex-mini-bar' }, [titleEl, jumpForm]);

  const scroll = el('div', { class: 'game-hex-mini-scroll' });
  const topPad = el('div', { class: 'game-hex-mini-pad' });
  const bottomPad = el('div', { class: 'game-hex-mini-pad' });
  scroll.appendChild(topPad);
  scroll.appendChild(bottomPad);

  host.appendChild(bar);
  host.appendChild(scroll);

  let bytes = null;
  let totalRows = 0;
  let viewportHeight = 0;
  let rowPool = [];

  function ensurePool(n) {
    while (rowPool.length < n) {
      rowPool.push(el('div', { class: 'game-hex-mini-row' }));
    }
  }

  function buildRow(rowIdx) {
    const off = rowIdx * ROW_BYTES;
    const end = Math.min(bytes.byteLength, off + ROW_BYTES);
    const slice = bytes.subarray(off, end);

    let hexStr = '';
    let ascStr = '';
    for (let i = 0; i < slice.length; i++) {
      hexStr += hex2(slice[i]);
      ascStr += asciiCh(slice[i]);
      if (i === 7) hexStr += '  ';
      else if (i < slice.length - 1) hexStr += ' ';
    }

    return [
      el('span', { class: 'addr', text: hex8(off) }),
      el('span', { class: 'bytes', text: hexStr }),
      el('span', { class: 'ascii', text: ascStr }),
    ];
  }

  function render() {
    if (!bytes) {
      replaceChildren(scroll, [topPad, bottomPad]);
      topPad.style.height = '0px';
      bottomPad.style.height = '0px';
      return;
    }
    const scrollTop = scroll.scrollTop;
    const firstVisible = Math.floor(scrollTop / ROW_HEIGHT);
    const rowCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
    const start = Math.max(0, firstVisible - OVERSCAN);
    const end = Math.min(totalRows, start + rowCount);
    const count = end - start;

    topPad.style.height = `${start * ROW_HEIGHT}px`;
    bottomPad.style.height = `${(totalRows - end) * ROW_HEIGHT}px`;

    ensurePool(count);
    // Detach pool nodes beyond count.
    for (let i = count; i < rowPool.length; i++) {
      if (rowPool[i].parentNode) rowPool[i].remove();
    }
    for (let i = 0; i < count; i++) {
      const cells = buildRow(start + i);
      replaceChildren(rowPool[i], cells);
      if (rowPool[i].parentNode !== scroll) {
        scroll.insertBefore(rowPool[i], bottomPad);
      }
    }
  }

  function setBytes(b) {
    bytes = b;
    totalRows = b ? Math.ceil(b.byteLength / ROW_BYTES) : 0;
    titleEl.textContent = b ? `ROM (${b.byteLength.toLocaleString()} bytes)` : 'ROM (empty)';
    scroll.scrollTop = 0;
    render();
  }

  function jumpTo(off) {
    if (!bytes || off < 0 || off >= bytes.byteLength) return;
    const row = Math.floor(off / ROW_BYTES);
    scroll.scrollTop = Math.max(0, row * ROW_HEIGHT - viewportHeight / 2);
    render();
  }

  scroll.addEventListener('scroll', render);
  const ro = new ResizeObserver(() => {
    viewportHeight = scroll.clientHeight;
    render();
  });
  ro.observe(scroll);

  jumpForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = jumpInput.value.trim().replace(/^0x/i, '');
    const n = parseInt(raw, 16);
    if (!Number.isNaN(n)) jumpTo(n);
  });

  return { host, setBytes, jumpTo };
}

export function createGame() {
  const host = document.createElement('section');
  host.className = 's-game';

  let gba = null;
  let currentBytes = null;
  let running = false;
  let romLoaded = false; // setRom has been called on `gba` for currentBytes

  // ---- left pane: emulator canvas + controls -----------------------------
  const canvas = el('canvas', { class: 'game-canvas' });
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
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

  // ---- right pane: cart header + lightweight virtualized hex viewer ------
  const cartHead = el('div', { class: 'game-cart-head-wrap' });
  const miniHex = createMiniHex();

  const right = el('div', { class: 'game-right' }, [
    el('div', { class: 'game-bar' }, [
      el('span', { class: 'game-title', text: '[ ROM / INSPECTOR ]' }),
      el('span', { class: 'game-hint',  text: 'pause \u00B7 scroll \u00B7 jump 0x...' }),
    ]),
    cartHead,
    miniHex.host,
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
    gba.setLogger((level, msg) => console.warn('[scry/game/gba]', msg));
    gba.setCanvas(canvas);
    gba.setBios(window.biosBin);
    return gba;
  }

  // Boot a cart synchronously inside one frame. gbajs2's setRom does a
  // sync save-type scan that walks the whole cart, which is the source
  // of the second-long freeze users see. We don't dress that up with
  // fake-async progress text anymore — instead we wait for an explicit
  // PLAY click, paint a "loading…" frame, then let it block. That way
  // a 16 MiB Pokemon ROM doesn't lock the page just by landing in the
  // store; the freeze only happens when the user opts in.
  async function loadCartAndPlay() {
    if (!currentBytes) return;
    if (running) return;
    setStatus('loading ROM\u2026');
    // Two rAFs: first lets the status paint, second guarantees the
    // browser has run the paint before we start blocking.
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));
    try {
      const inst = ensureGba();
      if (!romLoaded) {
        const rom = currentBytes.buffer.slice(
          currentBytes.byteOffset,
          currentBytes.byteOffset + currentBytes.byteLength
        );
        const ok = inst.setRom(rom);
        if (!ok) {
          setStatus('rom rejected');
          return;
        }
        romLoaded = true;
      }
      canvas.focus();
      inst.runStable();
      running = true;
      setStatus('running');
    } catch (e) {
      console.error('[scry/game] load failed', e);
      setStatus('error: ' + (e?.message || e));
    }
  }

  function play() {
    if (!currentBytes) return;
    if (running) return;
    if (!romLoaded) {
      // First click: pay the load cost.
      loadCartAndPlay();
      return;
    }
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
    const wasRunning = running;
    pause();
    romLoaded = false;
    if (wasRunning) loadCartAndPlay();
    else setStatus('cart ready \u00B7 click PLAY');
  }

  playBtn.addEventListener('click', play);
  pauseBtn.addEventListener('click', pause);
  resetBtn.addEventListener('click', reset);

  // React to file changes. We DO NOT auto-load the cart into gbajs —
  // setRom blocks the main thread for a second+ on a 16 MiB cart while
  // it scans for save type. Instead we just show the header + hex
  // viewer and wait for an explicit PLAY click. The user pays the freeze
  // when they ask for it, with a clear "loading ROM…" status.
  fileStore.subscribe(state => {
    const bytes = state.bytes;
    if (gba && running) pause();
    if (!bytes) {
      currentBytes = null;
      romLoaded = false;
      replaceChildren(cartHead, []);
      miniHex.setBytes(null);
      setStatus('idle');
      return;
    }
    if (bytes.byteLength < 0xC0 || bytes[0xB2] !== 0x96) {
      currentBytes = null;
      romLoaded = false;
      replaceChildren(cartHead, []);
      miniHex.setBytes(null);
      setStatus('not a GBA cart');
      return;
    }
    currentBytes = bytes;
    romLoaded = false;
    replaceChildren(cartHead, [buildCartHead(bytes)]);
    miniHex.setBytes(bytes);
    miniHex.jumpTo(0xA0); // land on the cartridge header
    setStatus('cart ready \u00B7 click PLAY');
  });

  return host;
}
