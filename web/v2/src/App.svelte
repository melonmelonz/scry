<script>
  import { ensureWasm } from './lib/wasm.js';
  import { toggleTheme, currentTheme } from './lib/theme.js';
  import { buildDemoElf, DEMO_NAME } from '../../v1/js/demo/rv32_demo.js';
  import Drop from './lib/Drop.svelte';
  import Inspect from './lib/Inspect.svelte';
  import Hex from './lib/Hex.svelte';
  import Wave from './lib/Wave.svelte';
  import Cart from './lib/Cart.svelte';
  import Game from './lib/Game.svelte';
  import Disasm from './lib/Disasm.svelte';
  import FileRail from './lib/FileRail.svelte';
  import GlobalDrop from './lib/GlobalDrop.svelte';

  let file = $state(null);     // { name, bytes }
  let format = $state(null);   // 'elf' | 'pe' | ...
  let report = $state(null);   // ElfReport | null
  let wavReport = $state(null); // WavReport | null
  let gbaHeader = $state(null); // GbaHeader | null
  let strings = $state(null);  // [{ offset, text }]
  let avgEntropy = $state(null); // number 0..8 (Shannon bits) | null
  let error  = $state('');
  let view   = $state('inspect'); // 'inspect' | 'hex' | 'disasm' | ...
  let theme  = $state(currentTheme());
  let parsing = $state(false);
  let hexJumpTo = $state(null);
  let gamePc = $state(null);

  // First-paint status-bar type-out. Session-gated so it only happens on
  // cold load, not every navigation.
  let bootTyped = $state('');
  let bootDone = $state(false);
  const BOOT_TARGET = 'scry · awaiting binary';
  const BOOT_KEY = 'scry-booted-v2';

  // Per-view bottom-bar hints. Mirrors v1's hint store contract — short
  // tracked text that surfaces what's available in the current pane.
  const HINTS = {
    inspect: 'click a section/segment/string -> jump in HEX',
    hex:     'scroll or PgUp/PgDn, type a hex offset to jump, click the strip',
    disasm:  'RV32IMA disassembly · PgUp/PgDn/Home/End to navigate · GOTO to jump by address',
    wave:    'click the canvas to seek · play / stop control the buffer',
    cart:    'rust-decoded header · switch to GAME to play',
    game:    'play the cart · arrows · Z/X = A/B · Enter = Start',
  };

  // When iframed under the unified shell (?embed=1) the parent paints brand,
  // theme toggle, back link, and the mint stripe. Hide our copies so the
  // chrome doesn't double up.
  const embedded = typeof location !== 'undefined' && /[?&]embed=1\b/.test(location.search);

  // Accept theme + load-demo pushes from the parent shell.
  $effect(() => {
    function onmsg(ev) {
      if (ev.origin !== location.origin) return;
      const m = ev.data;
      if (!m) return;
      if (m.type === 'scry-theme' && (m.value === 'light' || m.value === 'dark')) {
        document.documentElement.setAttribute('data-theme', m.value);
        theme = m.value;
      } else if (m.type === 'scry-load-demo') {
        loadDemo();
      }
    }
    window.addEventListener('message', onmsg);
    return () => window.removeEventListener('message', onmsg);
  });

  function sizeFmt(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KiB';
    return (n / 1024 / 1024).toFixed(1) + ' MiB';
  }

  function sampledEntropyBits(bytes) {
    if (!bytes || bytes.length === 0) return null;
    const cap = 256 * 1024;
    const stride = Math.max(1, Math.ceil(bytes.length / cap));
    const hist = new Uint32Array(256);
    let n = 0;
    for (let i = 0; i < bytes.length; i += stride) {
      hist[bytes[i]]++;
      n++;
    }
    if (!n) return null;
    let h = 0;
    for (let i = 0; i < hist.length; i++) {
      const c = hist[i];
      if (!c) continue;
      const p = c / n;
      h -= p * Math.log2(p);
    }
    return h;
  }

  let onfileGeneration = 0;
  async function onfile({ name, bytes }) {
    const gen = ++onfileGeneration;
    file = { name, bytes };
    error = '';
    report = null;
    wavReport = null;
    gbaHeader = null;
    strings = null;
    format = null;
    avgEntropy = null;
    gamePc = null;
    parsing = true;
    try {
      const core = await ensureWasm();
      if (gen !== onfileGeneration) return;
      format = core.detect_format(bytes);
      if (format === 'elf') {
        report = core.parse_elf(bytes);
        view = 'inspect';
      } else if (format === 'wav') {
        try { wavReport = core.decode_wav(bytes); } catch { /* surface in Wave pane */ }
        view = 'wave';
      } else if (format === 'gba') {
        try { gbaHeader = core.parse_gba(bytes); } catch { /* surface in Cart pane */ }
        view = 'game';
      } else {
        view = 'hex';
      }

      if (gen !== onfileGeneration) return;
      if (format === 'elf') {
        strings = core.extract_strings(bytes, 4);
      }
      if (format !== 'gba') {
        avgEntropy = sampledEntropyBits(bytes);
      }
    } catch (e) {
      if (gen === onfileGeneration) error = String(e);
    } finally {
      if (gen === onfileGeneration) parsing = false;
    }
  }

  function reset() {
    file = null; report = null; wavReport = null; gbaHeader = null; strings = null; format = null; error = '';
    avgEntropy = null; gamePc = null;
  }

  function onDropError(msg) {
    error = msg;
  }

  function doToggle() { theme = toggleTheme(); }
  function loadDemo() { onfile({ name: DEMO_NAME, bytes: buildDemoElf() }); }

  function jumpToOffset(o) {
    view = 'hex';
    // Force the effect to re-fire even if the same offset is asked for.
    hexJumpTo = { o, t: performance.now() };
  }

  function onGamePcUpdate(pc) {
    gamePc = pc;
  }

  // Build a compact bracketed format chip from parsed info, e.g.
  //   "ELF · RISC-V · 32-bit · EXEC"
  // Falls back gracefully when we only have format detection.
  let fileBadge = $derived.by(() => {
    if (!file) return null;
    if (report) {
      const s = report.summary;
      return [format?.toUpperCase(), s.machine, s.class, s.kind].filter(Boolean).join(' · ');
    }
    return (format || 'raw').toUpperCase();
  });

  // Sub-badge prose: "32-bit RISC-V · 7 sections · 132 symbols · avg entropy 4.2 bits"
  // Or for non-ELF: "bytes only · entropy X.X bits". Returns null until we
  // have at least an entropy reading.
  let autoSummary = $derived.by(() => {
    if (!file) return null;
    if (report) {
      const s = report.summary;
      const bits = [];
      if (s.class && s.machine) bits.push(`${s.class} ${s.machine}`);
      else if (s.machine) bits.push(s.machine);
      bits.push(`${report.sections.length} sections`);
      bits.push(`${report.symbols.length} symbols`);
      if (avgEntropy != null) bits.push(`avg entropy ${avgEntropy.toFixed(1)} bits`);
      return bits.join(' · ');
    }
    if (wavReport) {
      const f = wavReport.fmt;
      const dur = wavReport.duration < 1
        ? `${(wavReport.duration * 1000).toFixed(0)} ms`
        : `${wavReport.duration.toFixed(2)} s`;
      const bits = [`${f.channels}ch ${f.sample_rate} Hz`, `${f.bits_per_sample}-bit`, dur];
      if (avgEntropy != null) bits.push(`avg entropy ${avgEntropy.toFixed(1)} bits`);
      return bits.join(' · ');
    }
    if (gbaHeader) {
      const bits = [`GBA cart`, `"${gbaHeader.title || '(blank)'}"`, `code ${gbaHeader.game_code}`];
      if (avgEntropy != null) bits.push(`avg entropy ${avgEntropy.toFixed(1)} bits`);
      return bits.join(' · ');
    }
    if (avgEntropy != null) return `bytes only · entropy ${avgEntropy.toFixed(1)} bits`;
    return null;
  });

  // Boot type-out for the status bar. Skips on subsequent loads in the same
  // tab session — once typed, the status line snaps to its real value.
  $effect(() => {
    if (sessionStorage.getItem(BOOT_KEY)) {
      bootTyped = BOOT_TARGET;
      bootDone = true;
      return;
    }
    let i = 0;
    const id = setInterval(() => {
      i++;
      bootTyped = BOOT_TARGET.slice(0, i);
      if (i >= BOOT_TARGET.length) {
        clearInterval(id);
        bootDone = true;
        try { sessionStorage.setItem(BOOT_KEY, '1'); } catch { /* private mode */ }
      }
    }, 60);
    return () => clearInterval(id);
  });
</script>

<GlobalDrop {onfile} onerror={onDropError} />

<div class="app" class:embedded>
  <header class="s-header">
    {#if !embedded}
      <button class="s-brand-btn" type="button" onclick={reset} title={file ? 'Clear file · back to import' : ''}>
        <span class="s-brand" class:s-brand-clickable={!!file}>scry</span>
      </button>
    {/if}
    {#if file}
      <span class="s-meta">
        {#if fileBadge}
          <span class="badge-wrap">
            {#key file.name}
              <span class="s-badge entrance">[ {fileBadge} ]</span>
            {/key}
            {#if autoSummary}
              <span class="s-summary">{autoSummary}</span>
            {/if}
          </span>
        {/if}
        {#if parsing}
          <span class="s-parsing">parsing…</span>
        {/if}
        <button class="s-close" type="button" onclick={reset}>CLOSE</button>
      </span>
    {:else}
      <span class="s-meta"><span>WORKBENCH &middot; v0.1 &middot; RUST&middot;WASM</span></span>
    {/if}
    {#if !embedded}
      <span class="s-right">
        <button class="s-theme" type="button" onclick={doToggle} aria-label="Toggle theme">
          {theme === 'dark' ? '\u263C' : '\u263E'}
        </button>
        <a class="s-back" href="/">↩ scry root</a>
      </span>
    {/if}
  </header>

  <div class="s-body">
    <FileRail {file} {format} {parsing} />
    <div class="s-work">
      {#if file}
        <nav class="s-tabs">
          <button
            class:on={view === 'inspect'}
            disabled={format !== 'elf'}
            title={format === 'elf' ? '' : 'INSPECT is ELF-only'}
            onclick={() => (view = 'inspect')}
          >INSPECT</button>
          <button
            class:on={view === 'hex'}
            onclick={() => (view = 'hex')}
          >HEX</button>
          <button
            class:on={view === 'wave'}
            disabled={format !== 'wav'}
            title={format === 'wav' ? '' : 'WAVE is RIFF/WAVE-only'}
            onclick={() => (view = 'wave')}
          >WAVE</button>
          <button
            class:on={view === 'cart'}
            disabled={format !== 'gba'}
            title={format === 'gba' ? '' : 'CART is GBA-only'}
            onclick={() => (view = 'cart')}
          >CART</button>
          <button
            class:on={view === 'game'}
            disabled={format !== 'gba'}
            title={format === 'gba' ? '' : 'GAME is GBA-only'}
            onclick={() => (view = 'game')}
          >GAME</button>
          <button
            class:on={view === 'disasm'}
            disabled={format !== 'elf'}
            title={format === 'elf' ? '' : 'DISASM is ELF-only (RV32)'}
            onclick={() => (view = 'disasm')}
          >DISASM</button>
          <button disabled title="EMU lives in v1 today; v2 port is in flight">EMU</button>
          <button disabled title="TRACE lives in v1 today; v2 port is in flight">TRACE</button>
        </nav>
      {/if}

      <main class="s-main">
        {#if !file}
          <Drop {onfile} />
        {:else}
          {#if error}
            <p class="err">parse failed: {error}</p>
          {/if}

          {#if view === 'inspect'}
            {#if report}
              <Inspect {report} {strings} onJumpToOffset={jumpToOffset} />
            {:else if format && format !== 'elf'}
              <p class="todo">v2 currently inspects ELF only. Detected: <b>{format}</b>. PE / Mach-O / WASM headers-only panes are on the roadmap.</p>
            {/if}
          {:else if view === 'hex'}
            <Hex
              bytes={file.bytes}
              format={format}
              jumpTo={hexJumpTo}
              followTarget={gamePc?.follow && gamePc?.inCart ? gamePc : null}
            />
          {:else if view === 'disasm'}
            <Disasm bytes={file.bytes} {format} />
          {:else if view === 'wave'}
            <Wave bytes={file.bytes} />
          {:else if view === 'cart'}
            <Cart bytes={file.bytes} />
          {:else if view === 'game'}
            <Game bytes={file.bytes} header={gbaHeader} onPcUpdate={onGamePcUpdate} />
          {/if}
        {/if}
      </main>
    </div>
  </div>

  <footer class="s-status">
    <span>
      <span class="dot"></span>{file
        ? (embedded ? 'READY' : 'READY · LOCAL · NO UPLOAD')
        : (bootDone
            ? (embedded ? 'AWAITING FILE' : 'AWAITING FILE · LOCAL · NO UPLOAD')
            : `${bootTyped}\u2588`)}
    </span>
    {#if file}
      <span class="s-hint">{HINTS[view] ?? ''}</span>
    {/if}
    <span class="s-status-right">
      MODULE &middot; {file ? view.toUpperCase() : 'EMPTY'} &middot; RUST&middot;WASM v0.1
    </span>
  </footer>
</div>

<style>
  /* Match v1's frame layout: header, body (rail + main), status bar.
     Tabs now live inside .s-body (right of the rail) — mirrors v1. */
  .app {
    display: grid;
    grid-template-rows: auto 1fr auto;
    height: 100vh;
  }
  /* Embedded inside the unified shell — fill the iframe height, not the
     parent viewport. Status bar stays (mirrors v1). */
  .app.embedded { height: 100%; }

  .s-body {
    display: grid;
    grid-template-columns: 220px 1fr;
    min-height: 0;
    overflow: hidden;
  }
  .s-work {
    display: grid;
    grid-template-rows: auto 1fr;
    min-height: 0;
    min-width: 0;
  }
  /* When no tab bar (empty state) the work pane is a single row. */
  .s-work:not(:has(.s-tabs)) { grid-template-rows: 1fr; }

  /* ─── Header (mirrors v1 .s-header) ────────── */
  .s-header {
    padding: 14px 22px 12px;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-bottom: var(--r-strong);
    gap: 16px;
  }
  .embedded .s-header {
    padding: 10px 18px 8px;
    justify-content: flex-end;
  }
  .s-brand-btn {
    background: transparent;
    border: 0;
    padding: 0;
    font: inherit;
    cursor: default;
  }
  .s-brand-btn:has(.s-brand-clickable) { cursor: pointer; }
  .s-brand {
    font-weight: 600;
    font-size: var(--fs-body-2);
    letter-spacing: 0.04em;
    color: var(--ink);
    transition: color 120ms ease;
  }
  .s-brand::before {
    content: '◆ ';
    color: var(--mint-deep);
    font-size: var(--fs-chrome-2);
  }
  .s-brand-clickable:hover { color: var(--mint-deep); }
  .s-brand-clickable:hover::before { content: '\u21A9 '; }
  .s-meta {
    display: flex;
    gap: var(--sp-5);
    color: var(--muted);
    font-size: var(--fs-chrome);
    letter-spacing: 0.12em;
    align-items: flex-start;
  }
  /* (legacy .s-meta .v rule removed — file/size now live in the FileRail) */
  .badge-wrap {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--sp-1);
    position: relative;
  }
  /* The ink rule under the badge wipes in from the left. ::after lives on
     the wrapper so it spans badge + summary text predictably. */
  .badge-wrap::after {
    content: '';
    position: absolute;
    left: 0;
    bottom: -3px;
    width: 100%;
    height: 1px;
    background: var(--ink);
    transform-origin: left center;
    transform: scaleX(0);
    animation: badge-rule 300ms ease-out 100ms forwards;
  }
  .s-badge {
    color: var(--mint-deep);
    border: 1px solid var(--mint-deep);
    padding: 1px 6px;
    font-size: 9px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .s-badge.entrance {
    animation: badge-in 250ms ease-out both;
  }
  @keyframes badge-in {
    from { opacity: 0; transform: translateX(8px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  @keyframes badge-rule {
    from { transform: scaleX(0); }
    to   { transform: scaleX(1); }
  }
  .s-summary {
    font-size: var(--fs-label);
    color: var(--muted);
    letter-spacing: var(--tr-label);
    text-transform: uppercase;
    margin-top: var(--sp-2);
  }
  .s-parsing {
    color: var(--accent-system);
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    animation: pulse 1s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.5; }
    50%      { opacity: 1; }
  }
  .s-close {
    font-family: inherit;
    font-size: 9px;
    letter-spacing: var(--tr-bracket);
    color: var(--muted);
    background: transparent;
    border: 1px solid var(--rule);
    padding: 3px 8px;
    cursor: pointer;
  }
  .s-close:hover { color: var(--ink); border-color: var(--mint-deep); }
  .s-right {
    display: inline-flex;
    align-items: baseline;
    gap: var(--sp-4);
  }
  .s-theme {
    font-family: inherit;
    font-size: 13px;
    line-height: 1;
    color: var(--mint-deep);
    background: transparent;
    border: 1px solid var(--rule);
    width: 26px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    align-self: center;
  }
  .s-theme:hover { color: var(--ink); border-color: var(--mint-deep); background: var(--mint-pale); }
  .s-back {
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--mint-deep);
  }

  /* ─── Tab bar (mirrors v1 .s-tabs) ─────────── */
  .s-tabs { display: flex; border-bottom: var(--r-thin); }
  .s-tabs button {
    padding: 11px 18px;
    font-size: var(--fs-chrome);
    letter-spacing: var(--tr-label);
    text-transform: uppercase;
    color: var(--muted);
    border: 0;
    border-right: var(--r-thin);
    transition: color var(--t-fast);
    font-family: inherit;
    background: transparent;
  }
  .s-tabs button:hover:not(:disabled) { color: var(--ink); background: transparent; }
  .s-tabs button.on {
    color: var(--ink);
    border-bottom: 2px solid var(--mint-deep);
    margin-bottom: -1px;
    background: var(--paper);
  }
  .s-tabs button:disabled {
    color: var(--rule);
    cursor: not-allowed;
  }

  /* ─── Main pane ────────────────────────────── */
  .s-main {
    overflow: auto;
    position: relative;
    min-height: 0;
    padding: 0 22px 22px;
    display: flex;
    flex-direction: column;
  }

  .err {
    background: var(--mint-pale);
    border-left: 3px solid var(--accent-system);
    padding: 10px 14px;
    font-size: 11px;
    margin-bottom: 10px;
  }
  .todo {
    padding: 24px;
    color: var(--muted);
    font-size: 11px;
    background: var(--paper);
    border: 1px solid var(--rule);
  }

  /* ─── Status bar (mirrors v1 .s-status) ────── */
  .s-status {
    padding: 9px 22px;
    display: flex;
    justify-content: space-between;
    border-top: var(--r-thin);
    font-size: var(--fs-label);
    color: var(--muted);
    letter-spacing: 0.12em;
  }
  .s-status .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    background: var(--mint-deep);
    border-radius: 50%;
    margin-right: 6px;
    vertical-align: 1px;
  }
  .s-status-right { display: inline-flex; gap: 4px; }
  .s-hint {
    color: var(--muted);
    font-size: var(--fs-label);
    letter-spacing: 0.08em;
    text-transform: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    text-align: center;
    padding: 0 16px;
  }
</style>
