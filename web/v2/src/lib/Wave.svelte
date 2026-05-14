<script>
  // Renders the WavReport struct produced by scry-core::decode_wav. Header
  // chunk catalogue + peak/RMS canvas + Web Audio playback. Symmetric with
  // V1's wave.js but routed through the Rust decoder.
  import { ensureWasm } from './wasm.js';

  let { bytes } = $props();

  let report = $state(null);
  let error  = $state('');
  let canvasEl = $state(null);
  let wrapEl   = $state(null);

  let audioCtx = null;
  let source = null;
  let buffer = null;
  let playStartTime = 0;
  let playStartOffset = 0;
  let raf = 0;
  let clockText = $state('0:00 / 0:00');

  function hex8(n) { return '0x' + (Number(n) >>> 0).toString(16).padStart(8, '0').toUpperCase(); }
  function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024*1024) return `${(n/1024).toFixed(1)} KiB`;
    return `${(n/1024/1024).toFixed(2)} MiB`;
  }
  function fmtDuration(s) {
    if (s < 1) return `${(s*1000).toFixed(0)} ms`;
    if (s < 60) return `${s.toFixed(2)} s`;
    const m = Math.floor(s/60), r = s - m*60;
    return `${m}m ${r.toFixed(1)}s`;
  }
  function fmtTag(id) { return id.replace(/\s+$/g, ''); }

  async function decode(b) {
    error = '';
    if (!b) { report = null; return; }
    try {
      const core = await ensureWasm();
      const r = core.decode_wav(b);
      report = r;
      buffer = null; // reset on new file
      clockText = `0:00 / ${fmtDuration(r.duration)}`;
      requestAnimationFrame(() => draw({ playhead: 0 }));
    } catch (e) {
      console.error('[scry/wave] decode failed', e);
      report = null;
      error = String(e?.message || e);
    }
  }

  function draw({ playhead = null } = {}) {
    if (!canvasEl || !report) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvasEl.getBoundingClientRect();
    const W = Math.max(1, Math.floor(rect.width * dpr));
    const H = Math.max(1, Math.floor(rect.height * dpr));
    canvasEl.width = W; canvasEl.height = H;
    const cs = getComputedStyle(canvasEl);
    const bg     = cs.getPropertyValue('--w-bg').trim()     || '#000';
    const grid   = cs.getPropertyValue('--w-grid').trim()   || '#333';
    const peakC  = cs.getPropertyValue('--w-peak').trim()   || '#888';
    const rmsC   = cs.getPropertyValue('--w-rms').trim()    || '#bcd';
    const accent = cs.getPropertyValue('--w-accent').trim() || '#9fe3c7';
    const ctx = canvasEl.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    const mid = H / 2;
    for (const yFrac of [0.25, 0.5, 0.75]) {
      const y = Math.floor(H * yFrac) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    const env = report.envelope;
    const n = env.length;
    const bw = W / n;
    for (let i = 0; i < n; i++) {
      const e = env[i];
      const x = Math.floor(i * bw);
      const w = Math.max(1, Math.floor(bw) - 1);
      const yTop = mid - e.max * mid;
      const yBot = mid - e.min * mid;
      ctx.fillStyle = peakC;
      ctx.fillRect(x, Math.floor(yTop), w, Math.max(1, Math.ceil(yBot - yTop)));
      const r = e.rms * mid;
      ctx.fillStyle = rmsC;
      ctx.fillRect(x, Math.floor(mid - r), w, Math.max(1, Math.ceil(2 * r)));
    }
    if (playhead != null) {
      const x = Math.floor(playhead * W);
      ctx.strokeStyle = accent; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
  }

  function ensureBuffer() {
    if (!report) return null;
    if (buffer) return buffer;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const samples = report.samples instanceof Float32Array ? report.samples : new Float32Array(report.samples);
    buffer = audioCtx.createBuffer(1, samples.length, report.fmt.sample_rate);
    buffer.copyToChannel(samples, 0);
    return buffer;
  }

  function tickClock() {
    if (!audioCtx || !source || !report) { raf = 0; return; }
    const t = playStartOffset + (audioCtx.currentTime - playStartTime);
    const dur = report.duration;
    const ph = Math.max(0, Math.min(1, t / dur));
    draw({ playhead: ph });
    clockText = `${fmtDuration(Math.min(t, dur))} / ${fmtDuration(dur)}`;
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
    if (!report) return;
    const buf = ensureBuffer();
    if (!buf) return;
    stop();
    source = audioCtx.createBufferSource();
    source.buffer = buf;
    source.connect(audioCtx.destination);
    source.onended = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      draw({ playhead: 0 });
      clockText = `0:00 / ${fmtDuration(report.duration)}`;
      source = null;
    };
    if (audioCtx.state === 'suspended') audioCtx.resume();
    playStartOffset = Math.max(0, Math.min(report.duration - 0.001, seconds));
    playStartTime = audioCtx.currentTime;
    source.start(0, playStartOffset);
    raf = requestAnimationFrame(tickClock);
  }

  function onSeek(e) {
    if (!report) return;
    const rect = canvasEl.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    playFrom(x * report.duration);
  }

  $effect(() => {
    // Explicit read so Svelte tracks the prop and re-decodes when a new
    // file is loaded without the user leaving the WAVE tab.
    const b = bytes;
    decode(b);
    return () => stop();
  });

  $effect(() => {
    if (!wrapEl) return;
    const ro = new ResizeObserver(() => report && draw({ playhead: 0 }));
    ro.observe(wrapEl);
    return () => ro.disconnect();
  });
</script>

<div class="w-wrap">
  <div class="w-bar">
    <span class="w-title">[ WAVE / PCM AUDIO ]</span>
    {#if report}
      <span class="w-meta">{report.fmt.channels}ch @ {report.fmt.sample_rate} Hz · {report.fmt.bits_per_sample}-bit · {fmtDuration(report.duration)}</span>
    {/if}
  </div>

  {#if error}
    <div class="w-empty">Not a parseable WAV: {error}</div>
  {:else if !report}
    <div class="w-empty">Decoding…</div>
  {:else}
    <div class="w-header">
      <div class="w-grid">
        <div class="w-col">
          <div class="w-row"><span class="l">FORMAT</span><span class="v">{report.fmt.format === 1 ? 'PCM (int)' : report.fmt.format === 3 ? 'IEEE float' : `tag ${report.fmt.format}`}</span></div>
          <div class="w-row"><span class="l">CHANNELS</span><span class="v">{report.fmt.channels}</span></div>
          <div class="w-row"><span class="l">SAMPLE RATE</span><span class="v">{report.fmt.sample_rate} Hz</span></div>
          <div class="w-row"><span class="l">BIT DEPTH</span><span class="v">{report.fmt.bits_per_sample}-bit</span></div>
        </div>
        <div class="w-col">
          <div class="w-row"><span class="l">FRAMES</span><span class="v">{Number(report.total_frames).toLocaleString()}</span></div>
          <div class="w-row"><span class="l">DURATION</span><span class="v">{fmtDuration(report.duration)}</span></div>
          <div class="w-row"><span class="l">DATA SIZE</span><span class="v">{fmtBytes(report.data_len)}</span></div>
          <div class="w-row"><span class="l">BYTE RATE</span><span class="v">{fmtBytes(report.fmt.byte_rate)}/s</span></div>
        </div>
        <div class="w-col">
          <div class="w-row"><span class="l">CHUNKS</span><span class="v">{report.chunks.length}</span></div>
          {#each report.chunks.slice(0, 4) as c}
            <div class="w-row"><span class="l">{fmtTag(c.id)}</span><span class="v">{fmtBytes(c.size)} @ {hex8(c.offset)}</span></div>
          {/each}
        </div>
      </div>
    </div>

    <div class="w-controls">
      <button class="w-play" onclick={() => playFrom(0)}>PLAY</button>
      <button class="w-stop" onclick={() => { stop(); draw({playhead:0}); clockText = `0:00 / ${fmtDuration(report.duration)}`; }}>STOP</button>
      <span class="w-clock">{clockText}</span>
    </div>

    <div class="w-canvas-wrap" bind:this={wrapEl}>
      <canvas class="w-canvas" bind:this={canvasEl} onclick={onSeek}></canvas>
    </div>

    <p class="w-note">Rust-decoded RIFF/WAVE. PCM → Float32 envelope (256 buckets) for the canvas; full mono buffer flows into Web Audio. Click the canvas to seek.</p>
  {/if}
</div>

<style>
  .w-wrap {
    display: grid;
    grid-template-rows: auto auto auto 1fr auto;
    height: 100%;
    padding: 0 22px 22px;
    min-height: 0;
    --w-bg: var(--paper);
    --w-grid: var(--rule-soft);
    --w-peak: var(--ink-dim);
    --w-rms: var(--ink);
    --w-accent: var(--mint-deep);
  }
  :global(:root[data-theme='dark']) .w-wrap {
    --w-accent: var(--mint);
  }
  .w-bar {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 18px; padding: 16px 0 12px;
    border-bottom: 1px solid var(--grey);
  }
  .w-title { font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
  .w-meta  { font-size: 10px; color: var(--mint-deep); letter-spacing: 0.08em; }

  .w-header { padding: 12px 0; border-bottom: 1px solid var(--rule-soft); }
  .w-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 18px; }
  .w-col  { display: flex; flex-direction: column; gap: 4px; }
  .w-row  { display: flex; gap: 12px; align-items: baseline; font-size: 11px; letter-spacing: 0.02em; }
  .w-row .l { width: 86px; flex-shrink: 0; font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
  .w-row .v { color: var(--ink); }
  .w-empty { padding: 28px 0; color: var(--muted); font-size: 11px; font-style: italic; }

  .w-controls { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
  .w-play, .w-stop {
    font: inherit; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
    padding: 6px 14px;
    background: var(--paper); color: var(--ink); border: 1px solid var(--grey);
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  }
  .w-play:hover { background: var(--mint-pale); border-color: var(--mint-deep); color: var(--mint-deep); }
  .w-stop:hover { background: var(--surface-2); border-color: var(--ink-dim); }
  .w-clock { font-size: 11px; color: var(--muted); margin-left: auto; font-variant-numeric: tabular-nums; }

  .w-canvas-wrap { position: relative; width: 100%; min-height: 0; border: 1px solid var(--grey); background: var(--paper); }
  .w-canvas { display: block; width: 100%; height: 100%; cursor: crosshair; }
  .w-note { font-size: 10px; color: var(--muted); padding: 8px 0 0; margin: 0; font-style: italic; }
</style>
