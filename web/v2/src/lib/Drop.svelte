<script>
  // Landing pane. Mirrors v1's Empty module: drop zone + file picker, an
  // OR-PICK-A-SAMPLE row backed by the same `samples/manifest.json` v1
  // serves, and the in-browser-synthesized RV32 demo. Sources v1's
  // demo-builder so there is exactly one source of truth.
  import { buildDemoElf, DEMO_NAME } from '../../../v1/js/demo/rv32_demo.js';

  let { onfile } = $props();

  const MAX_BYTES = 64 * 1024 * 1024;
  // Mirrors v1's whitelist — defense in depth even though the manifest is
  // ours at build time.
  const SAMPLE_NAME_OK = /^[A-Za-z0-9._-]+\.elf$/;

  let hover = $state(false);
  let err = $state('');
  let samples = $state([]);
  let loading = $state('');

  function fmt(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KiB';
    return (n / 1024 / 1024).toFixed(1) + ' MiB';
  }

  async function accept(file) {
    err = '';
    if (file.size > MAX_BYTES) {
      err = `file too large (${fmt(file.size)} > ${fmt(MAX_BYTES)})`;
      return;
    }
    const buf = await file.arrayBuffer();
    onfile?.({ name: file.name, bytes: new Uint8Array(buf) });
  }

  function onDrop(e) {
    e.preventDefault();
    hover = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) accept(f);
  }
  function onDragOver(e) { e.preventDefault(); hover = true; }
  function onDragLeave() { hover = false; }
  function onPick(e) {
    const f = e.target.files?.[0];
    if (f) accept(f);
  }

  async function loadSample(file) {
    if (!SAMPLE_NAME_OK.test(file)) {
      err = `sample blocked: bad name "${file}"`;
      return;
    }
    err = '';
    loading = `fetching ${file}…`;
    try {
      // Samples live with v1 (one canonical copy). v2 is one peer dir over.
      const res = await fetch(`../v1/samples/${encodeURIComponent(file)}`);
      if (!res.ok) {
        err = `fetch failed: ${res.status}`;
        loading = '';
        return;
      }
      loading = `reading ${file}…`;
      const bytes = new Uint8Array(await res.arrayBuffer());
      loading = '';
      onfile?.({ name: file, bytes });
    } catch (e) {
      err = String(e);
      loading = '';
    }
  }

  function loadDemo() {
    err = '';
    onfile?.({ name: DEMO_NAME, bytes: buildDemoElf() });
  }

  // Best-effort manifest fetch. Silently no-op if absent (dev server, etc).
  $effect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('../v1/samples/manifest.json');
        if (!res.ok) return;
        const list = await res.json();
        if (!cancelled && Array.isArray(list)) samples = list;
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  });
</script>

<section class="empty">
  <div
    class="zone"
    class:over={hover}
    ondrop={onDrop}
    ondragover={onDragOver}
    ondragleave={onDragLeave}
    role="region"
    aria-label="Drop a binary"
  >
    <h2>Drop a binary to begin.</h2>
    <p class="subtitle">ELF &middot; raw bytes &middot; <span class="muted">(rust → wasm)</span></p>

    <div class="actions">
      <label class="pick">
        <input type="file" hidden onchange={onPick} />
        <span>Choose file</span>
      </label>
      <button class="pick demo" type="button" onclick={loadDemo}>Load RV32 demo</button>
    </div>

    {#if samples.length}
      <div class="samples">
        <div class="samples-label">OR PICK A SAMPLE</div>
        <div class="samples-row">
          {#each samples as s}
            <button
              type="button"
              class="sample"
              title="{s.desc} — {s.insns} instructions"
              onclick={() => loadSample(s.file)}
            >{s.file}</button>
          {/each}
        </div>
        <p class="samples-note">
          {samples.map(s => `${s.file} — ${s.desc}`).join('  ·  ')}
        </p>
      </div>
    {/if}

    {#if loading}
      <p class="loading">{loading}</p>
    {/if}
    {#if err}
      <p class="err">{err}</p>
    {/if}

    <p class="legend">All parsing happens in this tab. Nothing leaves your browser.</p>
  </div>
</section>

<style>
  /* Mirrors v1's .s-empty / .zone styling. */
  .empty {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 56px 24px;
  }
  .zone {
    border: 1px dashed var(--rule);
    border-radius: var(--r-3);
    padding: 80px 64px;
    text-align: center;
    background: var(--tint-row);
    max-width: 640px;
    transition: border-color var(--t-base), background var(--t-base);
  }
  .zone.over { border-color: var(--mint-deep); background: var(--mint-pale); }

  h2 {
    font-size: var(--fs-h2);
    font-weight: 400;
    margin-bottom: 12px;
    letter-spacing: -0.01em;
  }
  .subtitle { font-size: var(--fs-chrome-2); color: var(--muted); letter-spacing: 0.06em; }
  .subtitle .muted { color: var(--mint-deep); letter-spacing: 0.14em; }

  .actions {
    margin-top: 28px;
    display: flex;
    gap: 8px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .pick {
    display: inline-block;
    font-size: var(--fs-chrome);
    letter-spacing: var(--tr-label);
    text-transform: uppercase;
    padding: 10px 18px;
    border: 1px solid var(--mint-deep);
    color: var(--mint-deep);
    background: var(--paper);
    border-radius: var(--r-1);
    cursor: pointer;
    font-family: inherit;
    transition: background var(--t-fast);
  }
  .pick:hover { background: var(--mint-pale); }
  .pick.demo { padding: 10px 18px; }

  .samples {
    margin-top: 36px;
    border-top: 1px solid var(--rule);
    padding-top: 20px;
  }
  .samples-label {
    font-size: 9px;
    letter-spacing: 0.18em;
    color: var(--muted);
    margin-bottom: 12px;
  }
  .samples-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
  }
  .sample {
    font-family: inherit;
    font-size: 10px;
    letter-spacing: 0.04em;
    padding: 5px 10px;
    border: 1px solid var(--rule);
    background: var(--paper);
    color: var(--ink);
    border-radius: var(--r-1);
    cursor: pointer;
    text-transform: none;
    transition: border-color var(--t-fast), background var(--t-fast);
  }
  .sample:hover { border-color: var(--mint-deep); background: var(--mint-pale); }
  .samples-note {
    margin-top: 14px;
    font-size: 9px;
    color: var(--muted);
    letter-spacing: 0.04em;
    font-style: italic;
    line-height: 1.6;
    max-width: 480px;
    margin-left: auto;
    margin-right: auto;
  }

  .loading {
    margin-top: 18px;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--mint-deep);
  }
  .err { color: #c0392b; margin-top: 14px; font-size: 11px; }
  .legend {
    margin-top: 28px;
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
  }
</style>
