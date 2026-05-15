// GAME pane — DOM-mirror of v2's Game.svelte (lib/Game.svelte) so the
// parent shell's V1/V2 toggle shows the same surface from both engines.
// All class names are `g-*` and the CSS in css/game.css is a verbatim
// port of v2's <style> block.
//
// Implementation differences from v2 are limited to the reactivity
// layer (Store pub/sub vs Svelte $effect) — the visible output is
// identical pixel-for-pixel.

import { fileStore } from '../stores/file.js';
import { el, replaceChildren } from '../dom.js';
import { router } from '../stores/router.js';
import { gotoIn } from '../stores/nav.js';
import { setHint, clearHint } from '../stores/hint.js';
import { publishGamePc } from '../stores/gamepc.js';
import { describeGbaAddress, currentGbaMode, currentGbaPc } from '../gba/map.js';
import { hex2, hex8, fmtBytes, readAsciiZ } from '../fmt.js';
import { createMiniHex } from './minihex.js';

const CANVAS_W = 480;
const CANVAS_H = 320;
const PC_THROTTLE_MS = 100;
const PC_TRAIL_MAX = 8;

function cartMetaText(bytes) {
  const title = readAsciiZ(bytes, 0xA0, 12) || '(blank)';
  const code  = readAsciiZ(bytes, 0xAC, 4) || '----';
  return `"${title}" \u00B7 ${code} \u00B7 ${fmtBytes(bytes.byteLength)}`;
}

export function createGame() {
  let gba = null;
  let currentBytes = null;
  let romLoaded = false;
  let running = false;
  let follow = false;
  let pcCursor = null;
  let livePc = null;
  let pcMode = 'ARM';
  let pcTrail = [];
  let pcRaf = 0;
  let pcLastTick = 0;
  let inCart = false;

  // ── top bar with cart meta ────────────────────────────────────────────
  const gTitle = el('span', { class: 'g-title', text: '[ GBA / EMULATOR ]' });
  const gMeta  = el('span', { class: 'g-meta', text: '' });
  const gBar   = el('div',  { class: 'g-bar' }, [gTitle, gMeta]);

  // ── left: canvas + controls ───────────────────────────────────────────
  const canvas = el('canvas', { class: 'g-canvas' });
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  canvas.tabIndex = 0;

  const playBtn  = el('button', { class: 'g-btn', type: 'button', text: 'PLAY'  });
  const pauseBtn = el('button', { class: 'g-btn', type: 'button', text: 'PAUSE' });
  const resetBtn = el('button', { class: 'g-btn', type: 'button', text: 'RESET' });

  const followLed = el('span', { class: 'g-follow-led' });
  followLed.setAttribute('aria-hidden', 'true');
  const followLab = el('span', { class: 'g-follow-lab', text: 'FOLLOW PC' });
  const followBtn = el('button', { class: 'g-follow', type: 'button' }, [followLed, followLab]);
  followBtn.title = "Auto-scroll the ROM view to wherever the CPU's program counter currently is";

  const statusEl = el('span', { class: 'g-status', text: 'cart ready \u00B7 click PLAY' });
  const hintEl   = el('span', { class: 'g-hint', text: 'arrows = D-pad \u00B7 Z/X = A/B \u00B7 Enter = Start' });

  const canvasWrap = el('div', { class: 'g-canvas-wrap' }, [canvas]);
  const controls   = el('div', { class: 'g-controls' }, [playBtn, pauseBtn, resetBtn, followBtn, statusEl, hintEl]);
  const gLeft      = el('div', { class: 'g-left' }, [canvasWrap, controls]);

  // ── right: PC bar + mini-hex ──────────────────────────────────────────
  const subTitle = el('span', { class: 'g-sub-title', text: '[ ROM / INSPECTOR ]' });
  const subHint  = el('span', { class: 'g-sub-hint', text: 'pause \u00B7 scroll \u00B7 jump 0x...' });
  const subBar   = el('div',  { class: 'g-sub-bar' }, [subTitle, subHint]);

  const trailHost = el('div', { class: 'g-pc-trail' });
  const miniHex = createMiniHex({ onByteClick: handleMiniHexClick });
  const gRight  = el('div', { class: 'g-right' }, [subBar, miniHex.host, trailHost]);

  // ── split ─────────────────────────────────────────────────────────────
  const gSplit = el('div', { class: 'g-split' }, [gLeft, gRight]);
  const wrap   = el('section', { class: 'g-wrap' }, [gBar, gSplit]);

  // ── state helpers ─────────────────────────────────────────────────────
  function setStatus(t) {
    statusEl.textContent = t;
    refreshButtons();
  }
  function refreshButtons() {
    playBtn.disabled  = !currentBytes || running;
    pauseBtn.disabled = !running;
    resetBtn.disabled = !currentBytes || !romLoaded;
    followBtn.disabled = !romLoaded;
  }
  function refreshSubHint() {
    if (livePc) {
      replaceChildren(subHint, []);
      const live = hex8(livePc.address);
      const off = livePc.inCart && livePc.offset !== null ? ` \u00B7 ROM ${hex8(livePc.offset)}` : '';
      const mirror = livePc.mirrored ? ' \u00B7 mirror' : '';
      const main = el('span', { text: `${pcMode} PC\u2192${live} \u00B7 ${livePc.label}${off}${mirror}` });
      if (!livePc.inCart) main.classList.add('g-pc-dim');
      subHint.appendChild(main);
    } else if (running) {
      subHint.textContent = 'waiting for first PC sample\u2026';
    } else {
      subHint.textContent = 'pause \u00B7 scroll \u00B7 jump 0x...';
    }
  }

  function publishPc() {
    publishGamePc({
      follow,
      running,
      liveAddress: livePc?.address ?? null,
      label: livePc?.label ?? (romLoaded ? 'READY' : 'IDLE'),
      mode: pcMode,
      inCart,
      offset: pcCursor,
      mirrored: !!livePc?.mirrored,
      trail: pcTrail.slice(),
    });
  }

  function pushTrail(pcInfo) {
    if (!pcInfo?.inCart || pcInfo.offset === null) return;
    const last = pcTrail[0];
    if (last && Math.floor(last.offset / 16) === Math.floor(pcInfo.offset / 16)) return;
    pcTrail = [{
      address: pcInfo.address,
      offset: pcInfo.offset,
      label: pcInfo.label,
      mode: pcMode,
      mirrored: pcInfo.mirrored,
      ts: performance.now(),
    }, ...pcTrail].slice(0, PC_TRAIL_MAX);
    renderTrail();
  }

  function renderTrail() {
    if (!pcTrail.length) {
      trailHost.textContent = 'PC trail: waiting for cart code';
      return;
    }
    const rows = pcTrail.map((p, idx) => {
      const b = el('button', {
        class: `g-trail-row${idx === 0 ? ' hot' : ''}`,
        type: 'button',
        title: `Jump MiniHex and HEX to ${hex8(p.offset)}`,
      }, [
        el('span', { class: 'g-trail-age', text: idx === 0 ? 'NOW' : `-${idx}` }),
        el('span', { class: 'g-trail-pc', text: hex8(p.address) }),
        el('span', { class: 'g-trail-off', text: hex8(p.offset) }),
        el('span', { class: 'g-trail-mode', text: p.mode }),
      ]);
      b.addEventListener('click', () => {
        miniHex.jumpTo(p.offset);
        gotoIn('hex', p.offset, p.mode === 'THUMB' ? 2 : 4);
      });
      return b;
    });
    replaceChildren(trailHost, [
      el('div', { class: 'g-trail-title', text: 'RECENT CART PC' }),
      ...rows,
    ]);
  }

  function handleMiniHexClick(off) {
    const busAddr = (0x08000000 + off) >>> 0;
    if (running) {
      setHint('game', `ROM ${hex8(off)} \u00B7 byte selected while running`);
      return;
    }
    setHint('game', `ROM ${hex8(off)} \u00B7 bus ${hex8(busAddr)} \u00B7 ARM/THUMB disasm is not implemented in v1`);
  }

  // ── gba lifecycle ─────────────────────────────────────────────────────
  function ensureGba() {
    if (gba) return gba;
    if (typeof window.GameBoyAdvance !== 'function') throw new Error('gbajs not loaded');
    if (!window.biosBin) throw new Error('biosBin not loaded');
    gba = new window.GameBoyAdvance();
    // Force the software renderer. proxy.js's `new Worker('js/video/worker.js')`
    // 404s under our deployment; the failure fires async so video.js's sync
    // try/catch never falls back. Result: audio plays, canvas stays black.
    if (typeof window.GameBoyAdvanceSoftwareRenderer === 'function') {
      try { gba.video.renderPath?.worker?.terminate?.(); } catch (_) {}
      gba.video.renderPath = new window.GameBoyAdvanceSoftwareRenderer();
    }
    gba.keypad.eatInput = true;
    gba.logLevel = gba.LOG_ERROR;
    gba.setLogger((level, msg) => console.warn('[scry/v1/game/gba]', msg));
    gba.setCanvas(canvas);
    gba.setBios(window.biosBin);
    return gba;
  }

  async function play() {
    if (!currentBytes || running) return;
    canvas.focus();
    if (!romLoaded) {
      setStatus('loading ROM\u2026');
      // Two rAFs: first paints "loading", second guarantees the paint
      // committed before we start blocking on setRom.
      await new Promise(r => requestAnimationFrame(r));
      await new Promise(r => requestAnimationFrame(r));
      try {
        const inst = ensureGba();
        const rom = currentBytes.buffer.slice(
          currentBytes.byteOffset,
          currentBytes.byteOffset + currentBytes.byteLength
        );
        const ok = inst.setRom(rom);
        if (!ok) { setStatus('rom rejected'); return; }
        romLoaded = true;
        inst.runStable();
        running = true;
        setStatus('running');
        startPcPoll();
      } catch (e) {
        console.error('[scry/v1/game] load failed', e);
        setStatus('error: ' + (e?.message || e));
      }
      return;
    }
    gba.runStable();
    running = true;
    setStatus('running');
    startPcPoll();
  }

  function pause() {
    if (!gba || !gba.hasRom()) return;
    gba.pause();
    running = false;
    setStatus('paused');
    stopPcPoll();
    refreshSubHint();
    publishPc();
  }

  function reset() {
    if (!gba || !currentBytes) return;
    const wasRunning = running;
    if (wasRunning) { try { gba.pause(); } catch (_) {} running = false; }
    stopPcPoll();
    pcCursor = null;
    livePc = null;
    inCart = false;
    romLoaded = false;
    setStatus('cart ready \u00B7 click PLAY');
    refreshSubHint();
    miniHex.setCursor(null);
    publishPc();
    if (wasRunning) play();
  }

  // ── PC tracker (matches v2) ───────────────────────────────────────────
  function pollPc(ts) {
    pcRaf = requestAnimationFrame(pollPc);
    if (!running || !gba || !currentBytes) return;
    if (ts - pcLastTick < PC_THROTTLE_MS) return;
    pcLastTick = ts;
    const pc = currentGbaPc(gba.cpu);
    if (pc === null) return;
    pcMode = currentGbaMode(gba.cpu);
    livePc = describeGbaAddress(pc, currentBytes.byteLength);
    if (livePc.inCart && livePc.offset !== null) {
      pcCursor = livePc.offset;
      inCart = true;
      miniHex.setCursor(pcCursor);
      pushTrail(livePc);
    } else {
      inCart = false;
    }
    refreshSubHint();
    publishPc();
  }
  function startPcPoll() {
    if (pcRaf) return;
    pcLastTick = 0;
    pcRaf = requestAnimationFrame(pollPc);
  }
  function stopPcPoll() {
    if (pcRaf) cancelAnimationFrame(pcRaf);
    pcRaf = 0;
  }

  // ── handlers ──────────────────────────────────────────────────────────
  playBtn.addEventListener('click', play);
  pauseBtn.addEventListener('click', pause);
  resetBtn.addEventListener('click', reset);
  followBtn.addEventListener('click', () => {
    follow = !follow;
    followBtn.classList.toggle('g-follow-on', follow);
    followLab.textContent = follow ? 'FOLLOWING PC' : 'FOLLOW PC';
    miniHex.setFollow(follow);
    publishPc();
  });

  // ── react to file changes ─────────────────────────────────────────────
  const gameFileSub = (state) => {
    const bytes = state.bytes;
    if (gba && running) pause();
    if (!bytes) {
      currentBytes = null;
      romLoaded = false;
      pcCursor = null;
      livePc = null;
      pcTrail = [];
      inCart = false;
      follow = false;
      followBtn.classList.remove('g-follow-on');
      followLab.textContent = 'FOLLOW PC';
      gMeta.textContent = '';
      miniHex.setBytes(null);
      setStatus('idle');
      refreshSubHint();
      renderTrail();
      clearHint('game');
      publishPc();
      return;
    }
    if (bytes.byteLength < 0xC0 || bytes[0xB2] !== 0x96) {
      currentBytes = null;
      romLoaded = false;
      pcCursor = null;
      livePc = null;
      pcTrail = [];
      gMeta.textContent = '';
      miniHex.setBytes(null);
      setStatus('not a GBA cart');
      refreshSubHint();
      renderTrail();
      publishPc();
      return;
    }
    currentBytes = bytes;
    romLoaded = false;
    pcCursor = null;
    livePc = null;
    pcTrail = [];
    inCart = false;
    gMeta.textContent = cartMetaText(bytes);
    miniHex.setBytes(bytes);
    miniHex.jumpTo(0xA0);
    setStatus('cart ready \u00B7 click PLAY');
    refreshSubHint();
    renderTrail();
    publishPc();
  };
  gameFileSub.__dbg = 'game.fileSub';
  fileStore.subscribe(gameFileSub);

  // Auto-pause whenever the user navigates away from the GAME tab. gbajs2
  // runs on rAF; leaving it active while HEX/INSPECT/etc. try to mount steals
  // the main thread and the user thinks those tabs hung.
  const gameRouteSub = (route) => { if (route !== 'game' && running) pause(); };
  gameRouteSub.__dbg = 'game.routeSub';
  router.subscribe(gameRouteSub);

  return wrap;
}
