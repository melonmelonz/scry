import { el, replaceChildren } from '../dom.js';
import { fileStore } from '../stores/file.js';
import { parseWav } from '../format/wav.js';
import { setHint, clearHint } from '../stores/hint.js';

// Wave module — RIFF/WAVE viewer.
// Renders the fmt+chunk header, a peak/rms waveform on a canvas, and lets you
// play the buffer through Web Audio. The canvas redraws on resize.

function hex8(n) { return '0x' + (n >>> 0).toString(16).padStart(8, '0').toUpperCase(); }
function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(2)} MiB`;
}
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

  // Zero line + 50% gridlines.
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  const mid = H / 2;
  for (const yFrac of [0.25, 0.5, 0.75]) {
    const y = Math.floor(H * yFrac) + 0.5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Per-bucket peak + RMS bars.
  const n = envelope.length;
  const bw = W / n;
  for (let i = 0; i < n; i++) {
    const e = envelope[i];
    const x = Math.floor(i * bw);
    const w = Math.max(1, Math.floor(bw) - 1);
    // peak
    const yTop = mid - e.max * mid;
    const yBot = mid - e.min * mid;
    ctx.fillStyle = peak;
    ctx.fillRect(x, Math.floor(yTop), w, Math.max(1, Math.ceil(yBot - yTop)));
    // rms band
    const r = e.rms * mid;
    ctx.fillStyle = rms;
    ctx.fillRect(x, Math.floor(mid - r), w, Math.max(1, Math.ceil(2 * r)));
  }

  // Playhead.
  if (opts.playhead != null) {
    const x = Math.floor(opts.playhead * W);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
}

export function createWave() {
  const root = el('div', { class: 'w-wrap' });

  const titleEl = el('span', { class: 'w-title', text: '[ WAVE / PCM AUDIO ]' });
  const metaEl  = el('span', { class: 'w-meta',  text: '' });
  const bar = el('div', { class: 'w-bar' }, [titleEl, metaEl]);
  root.appendChild(bar);

  const headerPanel = el('div', { class: 'w-header' });
  root.appendChild(headerPanel);

  // Playback controls.
  const playBtn = el('button', { class: 'w-play', text: 'PLAY' });
  const stopBtn = el('button', { class: 'w-stop', text: 'STOP' });
  const clock   = el('span', { class: 'w-clock', text: '0:00 / 0:00' });
  const controls = el('div', { class: 'w-controls' }, [playBtn, stopBtn, clock]);
  root.appendChild(controls);

  // Canvas area.
  const canvas = el('canvas', { class: 'w-canvas' });
  const canvasWrap = el('div', { class: 'w-canvas-wrap' }, [canvas]);
  root.appendChild(canvasWrap);

  const note = el('p', {
    class: 'w-note',
    text: 'Hand-rolled RIFF/WAVE parser. PCM-decoded into Float32 for the canvas envelope and Web Audio playback. Click the canvas to seek.'
  });
  root.appendChild(note);

  // Per-render state.
  let parsed = null;
  let audioCtx = null;
  let source = null;
  let buffer = null;
  let playStartTime = 0;     // audioCtx.currentTime at .start()
  let playStartOffset = 0;   // seek position in seconds at .start()
  let raf = 0;

  function render() {
    const bytes = fileStore.get().bytes;
    if (!bytes) {
      parsed = null;
      buffer = null;
      replaceChildren(headerPanel, [
        el('div', { class: 'w-empty', text: 'No file loaded.' })
      ]);
      metaEl.textContent = '';
      clock.textContent = '0:00 / 0:00';
      const ctx = canvas.getContext('2d');
      ctx && ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    try {
      parsed = parseWav(bytes);
    } catch (err) {
      parsed = null;
      replaceChildren(headerPanel, [
        el('div', { class: 'w-empty', text: `Not a parseable WAV: ${err.message}` })
      ]);
      return;
    }
    const { fmt, duration, totalFrames, chunks, dataLen } = parsed;

    metaEl.textContent =
      `${fmt.channels}ch @ ${fmt.sampleRate} Hz · ${fmt.bitsPerSample}-bit · ${fmtDuration(duration)}`;
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

  canvas.addEventListener('mousemove', (e) => {
    if (!parsed) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    setHint(`seek to ${fmtDuration(x * parsed.duration)}`);
  });
  canvas.addEventListener('mouseleave', () => clearHint());

  // Redraw on resize (the canvas is fluid-width).
  const ro = new ResizeObserver(() => {
    if (parsed) drawWaveform(canvas, parsed.envelope, { playhead: 0 });
  });
  ro.observe(canvasWrap);

  fileStore.subscribe(render);
  render();

  return root;
}
