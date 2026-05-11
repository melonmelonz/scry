<script>
  // Renders the ElfReport struct produced by scry-core::parse_elf.
  let { report } = $props();

  let tab = $state('summary');
  const tabs = [
    ['summary',  'SUMMARY'],
    ['sections', 'SECTIONS'],
    ['segments', 'SEGMENTS'],
    ['symbols',  'SYMBOLS'],
  ];
</script>

<div class="wrap">
  <div class="tabs">
    {#each tabs as [k, label]}
      <button
        class="tab"
        class:active={tab === k}
        onclick={() => (tab = k)}
      >
        {label}
        {#if k === 'sections'}<span class="ct">{report.sections.length}</span>{/if}
        {#if k === 'segments'}<span class="ct">{report.segments.length}</span>{/if}
        {#if k === 'symbols'}<span class="ct">{report.symbols.length}</span>{/if}
      </button>
    {/each}
  </div>

  <div class="panel">
    {#if tab === 'summary'}
      <dl class="kv">
        <dt>CLASS</dt>      <dd>{report.summary.class}</dd>
        <dt>DATA</dt>       <dd>{report.summary.data}</dd>
        <dt>TYPE</dt>       <dd>{report.summary.kind}</dd>
        <dt>MACHINE</dt>    <dd>{report.summary.machine}</dd>
        <dt>ENTRY</dt>      <dd>{report.summary.entry}</dd>
        <dt>SECTIONS</dt>   <dd>{report.summary.n_sections}</dd>
        <dt>SEGMENTS</dt>   <dd>{report.summary.n_segments}</dd>
        <dt>SYMBOLS</dt>    <dd>{report.summary.n_symbols}</dd>
      </dl>
    {:else if tab === 'sections'}
      <table>
        <thead><tr><th>#</th><th>NAME</th><th>KIND</th><th>ADDR</th><th>OFF</th><th>SIZE</th><th>FLAGS</th></tr></thead>
        <tbody>
          {#each report.sections as s}
            <tr><td>{s.idx}</td><td>{s.name || '—'}</td><td>{s.kind}</td><td>{s.addr}</td><td>{s.offset}</td><td>{s.size}</td><td>{s.flags}</td></tr>
          {/each}
        </tbody>
      </table>
    {:else if tab === 'segments'}
      <table>
        <thead><tr><th>#</th><th>KIND</th><th>VADDR</th><th>OFF</th><th>FILESZ</th><th>MEMSZ</th><th>FLAGS</th></tr></thead>
        <tbody>
          {#each report.segments as s}
            <tr><td>{s.idx}</td><td>{s.kind}</td><td>{s.vaddr}</td><td>{s.offset}</td><td>{s.filesz}</td><td>{s.memsz}</td><td>{s.flags}</td></tr>
          {/each}
        </tbody>
      </table>
    {:else if tab === 'symbols'}
      <table>
        <thead><tr><th>NAME</th><th>BIND</th><th>KIND</th><th>VALUE</th><th>SIZE</th></tr></thead>
        <tbody>
          {#each report.symbols as s}
            <tr><td>{s.name}</td><td>{s.bind}</td><td>{s.kind}</td><td>{s.value}</td><td>{s.size}</td></tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>

<style>
  .wrap { display: flex; flex-direction: column; min-height: 0; gap: 10px; }
  .tabs { display: flex; gap: 4px; flex-wrap: wrap; }
  .tab {
    font-family: inherit;
    background: var(--paper);
    color: var(--muted);
    border: 1px solid var(--rule);
    padding: 4px 10px;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .tab.active { color: var(--mint-deep); border-color: var(--mint-deep); }
  .tab .ct { color: var(--muted); margin-left: 6px; letter-spacing: 0.06em; }
  .panel {
    border: 1px solid var(--rule);
    background: var(--paper);
    padding: 14px;
    overflow: auto;
    min-height: 0;
    flex: 1;
  }
  .kv {
    display: grid;
    grid-template-columns: 110px 1fr;
    gap: 6px 18px;
    font-size: 11px;
  }
  .kv dt {
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
  }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th, td {
    text-align: left;
    padding: 4px 8px;
    border-bottom: 1px dotted var(--grey);
    white-space: nowrap;
  }
  th {
    font-size: 9px;
    letter-spacing: 0.14em;
    color: var(--mint-deep);
    text-transform: uppercase;
  }
  tbody tr:hover { background: var(--mint-pale); }
</style>
