// WAVE pane — DOM-mirror of v2's Wave.svelte so the parent shell's V1/V2
// toggle shows the same surface from both engines. Class names are `w-*`
// and css/wave.css is a verbatim port of v2's <style> block.
//
// The decoder stays pure-JS (format/wav.js) — v2 routes through Rust+WASM,
// but the report shape we feed the renderer is identical. Reactivity is
// Store pub/sub instead of Svelte $effect. Visible output is intended to
// be pixel-for-pixel identical to Wave.svelte.

import { el, replaceChildren } from '../dom.js';
import { fileStore } from '../stores/file.js';
import { parseWav } from '../format/wav.js';
import { setHint, clearHint } from '../stores/hint.js';
import { router } from '../stores/router.js';
import { hex8, fmtBytes } from '../fmt.js';

function fmtDuration(s) {
  if (s < 1) return `${(s * 1000).toFixed(0)} ms`;
  if (s < 60) return `${s.toFixed(2)} s`;
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}m ${r.toFixed(1)}s`;
}
function fmtTag(id) { return id.replace(/\s+$/g, ''); }

function infoRow(label, value) {
  return el('div', { class: 'w-row' }, [
    el('span', { class: 'l', text: label }),
    el('span', { class: 'v', text: value })
  ]);
}

function drawWaveform(canvas, envelope, opts = {}) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const W = Math.max(1, Math.floor(rect.width  * dpr));
  const H = Math.max(1, Math.floor(rect.height * dpr));
  canvas.width = W;
  canvas.height = H;

  const cs = getComputedStyle(canvas);
  const bg     = cs.getPropertyValue('--w-bg').trim()     || '#000';
  const grid   = cs.getPropertyValue('--w-grid').trim()   || '#333';
  const peak   = cs.getPropertyValue('--w-peak').trim()   || '#888';
  const rms    = cs.getPropertyValue('--w-rms').trim()    || '#bcd';
  const accent = cs.getPropertyValue('--w-accent').trim() || '#9fe3c7';

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  const mid = H / 2;
  for (const yFrac of [0.25, 0.5, 0.75]) {
    const y = Math.floor(H * yFrac) + 0.5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  const n = envelope.length;
  const bw = W / n;
  for (let i = 0; i < n; i++) {
    const e = envelope[i];
    const x = Math.floor(i * bw);
    const w = Math.max(1, Math.floor(bw) - 1);
    const yTop = mid - e.max * mid;
    const yBot = mid - e.min * mid;
    ctx.fillStyle = peak;
    ctx.fillRect(x, Math.floor(yTop), w, Math.max(1, Math.ceil(yBot - yTop)));
    const r = e.rms * mid;
    ctx.fillStyle = rms;
    ctx.fillRect(x, Math.floor(mid - r), w, Math.max(1, Math.ceil(2 * r)));
  }

  if (opts.playhead != null) {
    const x = Math.floor(opts.playhead * W);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
}

export function createWave() {
  const root = el('div', { class: 'w-wrap' });

  // ── top bar (always rendered) ─────────────────────────────────────────
  const titleEl = el('span', { class: 'w-title', text: '[ WAVE / PCM AUDIO ]' });
  const metaEl  = el('span', { class: 'w-meta',  text: '' });
  const bar = el('div', { class: 'w-bar' }, [titleEl, metaEl]);
  root.appendChild(bar);

  // ── ready-state subtree (header + controls + canvas + note) ──────────
  // Built once, mounted/unmounted whole. Matches v2's `{#if report}` block.
  const headerPanel = el('div', { class: 'w-header' });

  const playBtn = el('button', { class: 'w-play', text: 'PLAY' });
  const stopBtn = el('button', { class: 'w-stop', text: 'STOP' });
  const clock   = el('span', { class: 'w-clock', text: '0:00 / 0:00' });
  const controls = el('div', { class: 'w-controls' }, [playBtn, stopBtn, clock]);

  const canvas = el('canvas', { class: 'w-canvas' });
  const canvasWrap = el('div', { class: 'w-canvas-wrap' }, [canvas]);

  const note = el('p', {
    class: 'w-note',
    text: 'Hand-rolled RIFF/WAVE parser. PCM-decoded into Float32 for the canvas envelope and Web Audio playback. Click the canvas to seek.'
  });

  const readyNodes = [headerPanel, controls, canvasWrap, note];

  // ── per-render state ─────────────────────────────────────────────────
  let parsed = null;
  let audioCtx = null;
  let source = null;
  let buffer = null;
  let playStartTime = 0;
  let playStartOffset = 0;
  let raf = 0;

  function setBarMeta(text) {
    metaEl.textContent = text;
    // v2 only renders .w-meta when report exists. Approximate by hiding
    // the span when empty so the bar's flex layout matches.
    metaEl.style.display = text ? '' : 'none';
  }

  function showEmpty(message) {
    parsed = null;
    buffer = null;
    setBarMeta('');
    replaceChildren(root, [bar, el('div', { class: 'w-empty', text: message })]);
  }

  function showReady() {
    // Mount the full ready-state subtree under root (bar stays as first child).
    replaceChildren(root, [bar, ...readyNodes]);
  }

  function render() {
    const bytes = fileStore.get().bytes;
    if (!bytes) {
      // v2's Wave is only mounted when a wav is loaded; if v1 lands here
      // with no bytes, mirror v2's null-state "Decoding…" empty.
      showEmpty('Decoding\u2026');
      return;
    }
    try {
      parsed = parseWav(bytes);
    } catch (err) {
      showEmpty(`Not a parseable WAV: ${err.message}`);
      return;
    }
    const { fmt, duration, totalFrames, chunks, dataLen } = parsed;

    showReady();

    setBarMeta(`${fmt.channels}ch @ ${fmt.sampleRate} Hz \u00B7 ${fmt.bitsPerSample}-bit \u00B7 ${fmtDuration(duration)}`);
    clock.textContent = `0:00 / ${fmtDuration(duration)}`;

    const tagFmt = fmt.format === 1 ? 'PCM (int)' : fmt.format === 3 ? 'IEEE float' : `tag ${fmt.format}`;
    const cols = el('div', { class: 'w-grid' }, [
      el('div', { class: 'w-col' }, [
        infoRow('FORMAT',      tagFmt),
        infoRow('CHANNELS',    String(fmt.channels)),
        infoRow('SAMPLE RATE', `${fmt.sampleRate} Hz`),
        infoRow('BIT DEPTH',   `${fmt.bitsPerSample}-bit`),
      ]),
      el('div', { class: 'w-col' }, [
        infoRow('FRAMES',      totalFrames.toLocaleString()),
        infoRow('DURATION',    fmtDuration(duration)),
        infoRow('DATA SIZE',   fmtBytes(dataLen)),
        infoRow('BYTE RATE',   fmtBytes(fmt.byteRate) + '/s'),
      ]),
      el('div', { class: 'w-col' }, [
        infoRow('CHUNKS',      String(chunks.length)),
        ...chunks.slice(0, 4).map(c => infoRow(fmtTag(c.id), `${fmtBytes(c.size)} @ ${hex8(c.off)}`))
      ])
    ]);
    replaceChildren(headerPanel, [cols]);

    requestAnimationFrame(() => drawWaveform(canvas, parsed.envelope, { playhead: 0 }));
  }

  function ensureBuffer() {
    if (!parsed) return null;
    if (buffer) return buffer;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const { fmt, samples } = parsed;
    buffer = audioCtx.createBuffer(1, samples.length, fmt.sampleRate);
    buffer.copyToChannel(samples, 0);
    return buffer;
  }

  function tickClock() {
    if (!audioCtx || !source) { raf = 0; return; }
    const t = playStartOffset + (audioCtx.currentTime - playStartTime);
    const dur = parsed.duration;
    const playhead = Math.max(0, Math.min(1, t / dur));
    drawWaveform(canvas, parsed.envelope, { playhead });
    clock.textContent = `${fmtDuration(Math.min(t, dur))} / ${fmtDuration(dur)}`;
    if (t < dur) raf = requestAnimationFrame(tickClock);
    else raf = 0;
  }

  function stop() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (source) {
      try { source.stop(); } catch {}
      source.disconnect();
      source = null;
    }
  }

  function playFrom(seconds) {
    if (!parsed) return;
    const buf = ensureBuffer();
    if (!buf) return;
    stop();
    source = audioCtx.createBufferSource();
    source.buffer = buf;
    source.connect(audioCtx.destination);
    source.onended = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      drawWaveform(canvas, parsed.envelope, { playhead: 0 });
      clock.textContent = `0:00 / ${fmtDuration(parsed.duration)}`;
      source = null;
    };
    if (audioCtx.state === 'suspended') audioCtx.resume();
    playStartOffset = Math.max(0, Math.min(parsed.duration - 0.001, seconds));
    playStartTime = audioCtx.currentTime;
    source.start(0, playStartOffset);
    raf = requestAnimationFrame(tickClock);
  }

  playBtn.addEventListener('click', () => playFrom(0));
  stopBtn.addEventListener('click', () => {
    stop();
    if (parsed) {
      drawWaveform(canvas, parsed.envelope, { playhead: 0 });
      clock.textContent = `0:00 / ${fmtDuration(parsed.duration)}`;
    }
  });

  canvas.addEventListener('click', (e) => {
    if (!parsed) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    playFrom(x * parsed.duration);
  });

  // Hint bar nicety — invisible in v2 because v2 doesn't have a hint bar,
  // so this can't break pixel parity.
  canvas.addEventListener('mousemove', (e) => {
    if (!parsed) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    setHint(`seek to ${fmtDuration(x * parsed.duration)}`);
  });
  canvas.addEventListener('mouseleave', () => clearHint());

  // Redraw on resize (canvas is fluid-width).
  const ro = new ResizeObserver(() => {
    if (parsed) drawWaveform(canvas, parsed.envelope, { playhead: 0 });
  });
  ro.observe(canvasWrap);

  // fileStore.subscribe fires immediately with the current state; the
  // initial null-bytes case is handled inside render() via showEmpty().
  const waveFileSub = () => render();
  waveFileSub.__dbg = 'wave.fileSub';
  fileStore.subscribe(waveFileSub);

  // Stop audio playback whenever the user leaves the WAVE tab. v1's
  // previous wave.js didn't do this; v2 does it via $effect cleanup.
  const waveRouteSub = (route) => { if (route !== 'wave') stop(); };
  waveRouteSub.__dbg = 'wave.routeSub';
  router.subscribe(waveRouteSub);

  return root;
}
