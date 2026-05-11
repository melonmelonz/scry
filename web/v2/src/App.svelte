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

  // When the unified shell iframes us with ?embed=1, hide our own brand +
  // theme toggle + back link; the parent provides those.
  const embedded = typeof location !== 'undefined' && /[?&]embed=1\b/.test(location.search);

  // Accept theme pushes from the parent shell so a toggle outside the
  // iframe lands instantly without a reload.
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

<div class="shell">
  <header class="hd">
    {#if !embedded}
      <span class="brand">scry / v2</span>
    {/if}
    <span class="sub">rust → wasm · svelte 5</span>
    <span class="spacer"></span>
    {#if file}
      <span class="file">{file.name} · {file.bytes.length.toLocaleString()} B · {format ?? '…'}</span>
      <button onclick={reset}>Close</button>
    {/if}
    {#if !embedded}
      <button class="theme" onclick={doToggle} aria-label="Toggle theme">
        {theme === 'dark' ? '\u263C' : '\u263E'}
      </button>
      <a class="back" href="/">↩ scry root</a>
    {/if}
  </header>

  {#if !file}
    <main class="empty">
      <Drop {onfile} />
    </main>
  {:else}
    <nav class="tabs">
      <button class:active={view === 'inspect'} onclick={() => (view = 'inspect')} disabled={format !== 'elf'}>
        INSPECT
        {#if format !== 'elf'}<span class="why" title="ELF only in v2 for now">·{format}</span>{/if}
      </button>
      <button class:active={view === 'hex'} onclick={() => (view = 'hex')}>HEX</button>
    </nav>

    <main class="body">
      {#if error}
        <p class="err">parse failed: {error}</p>
      {/if}

      {#if view === 'inspect'}
        {#if report}
          <Inspect {report} />
        {:else if format && format !== 'elf'}
          <p class="todo">v2 currently inspects ELF only. Detected: <b>{format}</b>. PE / Mach-O / WASM coming after the RV32 disassembler lands.</p>
        {/if}
      {:else if view === 'hex'}
        <Hex bytes={file.bytes} />
      {/if}
    </main>
  {/if}

  <footer class="ft">
    <span>LOCAL · NO UPLOAD</span>
    <span>v0.1 · scaffolding</span>
  </footer>
</div>

<style>
  .shell {
    display: grid;
    grid-template-rows: auto auto 1fr auto;
    height: 100vh;
    padding: 22px 26px;
    gap: 14px;
  }
  .hd {
    display: flex;
    align-items: baseline;
    gap: 16px;
    border-bottom: 1px solid var(--ink);
    padding-bottom: 12px;
  }
  .brand { font-weight: 600; font-size: 13px; letter-spacing: 0.04em; }
  .brand::before { content: '◆ '; color: var(--mint-deep); font-size: 11px; }
  .sub {
    font-size: 9px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .spacer { flex: 1; }
  .file { font-size: 10px; color: var(--mint-deep); letter-spacing: 0.06em; }
  .theme {
    font-family: inherit;
    width: 28px; height: 24px;
    padding: 0;
    color: var(--mint-deep);
    border: 1px solid var(--rule);
    display: inline-flex; align-items: center; justify-content: center;
  }
  .back { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; }

  .tabs { display: flex; gap: 6px; }
  .tabs button {
    background: var(--paper);
    color: var(--muted);
    border: 1px solid var(--rule);
  }
  .tabs button.active { color: var(--mint-deep); border-color: var(--mint-deep); }
  .tabs button:disabled { opacity: 0.55; cursor: not-allowed; }
  .why { color: var(--muted); margin-left: 6px; }

  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 0;
  }
  .body {
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .err {
    background: var(--mint-pale);
    border-left: 3px solid #c0392b;
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
  .ft {
    border-top: 1px solid var(--grey);
    padding-top: 12px;
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
  }
</style>
