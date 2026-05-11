<script>
  // Calls into scry-core::hex_rows for formatted lines and renders a window.
  import { ensureWasm } from './wasm.js';

  let { bytes } = $props();

  let offset = $state(0);
  const PAGE = 16 * 32; // 32 rows per page

  let rows = $state([]);
  let core = $state(null);

  $effect(() => {
    let cancelled = false;
    ensureWasm().then((c) => {
      if (cancelled) return;
      core = c;
      render();
    });
    return () => { cancelled = true; };
  });

  function render() {
    if (!core || !bytes) return;
    rows = core.hex_rows(bytes, offset, PAGE);
  }

  function move(d) {
    offset = Math.max(0, Math.min((bytes?.length ?? 0) - 1, offset + d));
    render();
  }
</script>

<div class="wrap">
  <div class="bar">
    <span class="ti">[ HEX ]</span>
    <div class="ctl">
      <button onclick={() => move(-PAGE)}>◀ PAGE</button>
      <button onclick={() => move(-16)}>▲ ROW</button>
      <span class="off">@ {offset.toString(16).padStart(8, '0').toUpperCase()}</span>
      <button onclick={() => move(16)}>▼ ROW</button>
      <button onclick={() => move(PAGE)}>PAGE ▶</button>
    </div>
  </div>
  <pre class="grid">{#each rows as line}{line}
{/each}</pre>
</div>

<style>
  .wrap { display: flex; flex-direction: column; min-height: 0; gap: 8px; }
  .bar { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .ti {
    font-size: 10px;
    letter-spacing: 0.16em;
    color: var(--mint-deep);
    text-transform: uppercase;
  }
  .ctl { display: flex; gap: 6px; align-items: baseline; }
  .off { font-size: 10px; color: var(--muted); letter-spacing: 0.06em; }
  .grid {
    flex: 1;
    overflow: auto;
    min-height: 0;
    border: 1px solid var(--rule);
    background: var(--paper);
    padding: 10px;
    font-size: 11px;
    line-height: 1.45;
    white-space: pre;
    font-family: var(--mono);
  }
</style>
