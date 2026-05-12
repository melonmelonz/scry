<script>
  import { ensureWasm } from './lib/wasm.js';
  import { toggleTheme, currentTheme } from './lib/theme.js';
  import Drop from './lib/Drop.svelte';
  import Inspect from './lib/Inspect.svelte';
  import Hex from './lib/Hex.svelte';

  let file = $state(null);     // { name, bytes }
  let format = $state(null);   // 'elf' | 'pe' | ...
  let report = $state(null);   // ElfReport | null
  let error  = $state('');
  let view   = $state('inspect'); // 'inspect' | 'hex'
  let theme  = $state(currentTheme());

  // When iframed under the unified shell (?embed=1) the parent paints brand,
  // theme toggle, back link, and the mint stripe. Hide our copies so the
  // chrome doesn't double up.
  const embedded = typeof location !== 'undefined' && /[?&]embed=1\b/.test(location.search);

  // Accept theme pushes from the parent shell.
  $effect(() => {
    function onmsg(ev) {
      if (ev.origin !== location.origin) return;
      const m = ev.data;
      if (m && m.type === 'scry-theme' && (m.value === 'light' || m.value === 'dark')) {
        document.documentElement.setAttribute('data-theme', m.value);
        theme = m.value;
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

  async function onfile({ name, bytes }) {
    file = { name, bytes };
    error = '';
    report = null;
    format = null;
    try {
      const core = await ensureWasm();
      format = core.detect_format(bytes);
      if (format === 'elf') {
        report = core.parse_elf(bytes);
      }
    } catch (e) {
      error = String(e);
    }
  }

  function reset() {
    file = null; report = null; format = null; error = '';
  }

  function doToggle() { theme = toggleTheme(); }
</script>

<div class="app" class:embedded>
  <header class="s-header">
    {#if !embedded}
      <span class="s-brand">scry</span>
    {/if}
    {#if file}
      <span class="s-meta">
        <span>FILE<span class="v">{file.name}</span></span>
        <span>SIZE<span class="v">{sizeFmt(file.bytes.length)}</span></span>
        <span>FMT<span class="v">{format ?? '…'}</span></span>
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
      <button disabled title="DISASM lives in v1 today; v2 port is in flight">DISASM</button>
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
          <Inspect {report} />
        {:else if format && format !== 'elf'}
          <p class="todo">v2 currently inspects ELF only. Detected: <b>{format}</b>. PE / Mach-O / WASM headers-only panes are on the roadmap.</p>
        {/if}
      {:else if view === 'hex'}
        <Hex bytes={file.bytes} />
      {/if}
    {/if}
  </main>

  <footer class="s-status">
    <span>
      <span class="dot"></span>{file ? 'READY' : 'AWAITING FILE'} &middot; LOCAL &middot; NO UPLOAD
    </span>
    <span class="s-status-right">
      MODULE &middot; {file ? view.toUpperCase() : 'EMPTY'} &middot; RUST&middot;WASM v0.1
    </span>
  </footer>
</div>

<style>
  /* Match v1's frame layout: header, tab bar, body, status bar. */
  .app {
    display: grid;
    grid-template-rows: auto auto 1fr auto;
    height: 100vh;
  }
  /* Without the tab bar (no file yet) collapse that row. */
  .app:not(:has(.s-tabs)) { grid-template-rows: auto 1fr auto; }
  /* Embedded inside the unified shell — fill the iframe height, not the
     parent viewport. Status bar stays (mirrors v1). */
  .app.embedded { height: 100%; }

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
  .s-brand {
    font-weight: 600;
    font-size: var(--fs-body-2);
    letter-spacing: 0.04em;
  }
  .s-brand::before {
    content: '◆ ';
    color: var(--mint-deep);
    font-size: var(--fs-chrome-2);
  }
  .s-meta {
    display: flex;
    gap: var(--sp-5);
    color: var(--muted);
    font-size: var(--fs-chrome);
    letter-spacing: 0.12em;
    align-items: baseline;
  }
  .s-meta .v { color: var(--ink); margin-left: var(--sp-1); }
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
</style>
