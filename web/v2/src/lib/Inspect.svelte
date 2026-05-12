<script>
  // Renders the ElfReport struct produced by scry-core::parse_elf, plus a
  // STRINGS pane fed by scry-core::extract_strings.
  let { report, strings, onJumpToOffset } = $props();

  let tab = $state('summary');
  const tabs = [
    ['summary',  'SUMMARY'],
    ['sections', 'SECTIONS'],
    ['segments', 'SEGMENTS'],
    ['symbols',  'SYMBOLS'],
    ['strings',  'STRINGS'],
  ];

  let stringQ = $state('');
  let filteredStrings = $derived.by(() => {
    if (!strings) return [];
    const q = stringQ.trim().toLowerCase();
    if (!q) return strings;
    return strings.filter(s => s.text.toLowerCase().includes(q));
  });

  // Max bar width for the sections-size mini-histogram (px).
  const BAR_MAX = 80;
  const maxSectionSize = $derived(
    report ? Math.max(1, ...report.sections.map(s => Number(s.size) || 0)) : 1
  );

  function hex(n) {
    return '0x' + Number(n).toString(16).toUpperCase().padStart(8, '0');
  }
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
        {#if k === 'strings' && strings}<span class="ct">{strings.length}</span>{/if}
      </button>
    {/each}
  </div>

  <div class="panel">
    {#if tab === 'summary'}
      <dl class="kv">
        <dt>CLASS</dt>      <dd>{report.summary.class}</dd>
        <dt>DATA</dt>       <dd>{report.summary.data}</dd>
        <dt>OS/ABI</dt>     <dd>{report.summary.osabi}</dd>
        <dt>TYPE</dt>       <dd>{report.summary.kind}</dd>
        <dt>MACHINE</dt>    <dd>{report.summary.machine}</dd>
        <dt>ENTRY</dt>      <dd class="addr">{report.summary.entry}</dd>
        <dt>SECTIONS</dt>   <dd>{report.summary.n_sections}</dd>
        <dt>SEGMENTS</dt>   <dd>{report.summary.n_segments}</dd>
        <dt>SYMBOLS</dt>    <dd>{report.summary.n_symbols}</dd>
      </dl>
    {:else if tab === 'sections'}
      <table>
        <thead><tr><th>#</th><th>NAME</th><th>KIND</th><th>ADDR</th><th>OFF</th><th>SIZE</th><th>FLAGS</th><th class="bar-h">─</th></tr></thead>
        <tbody>
          {#each report.sections as s}
            <tr
              class="clickable"
              title="Jump to offset {s.offset} in HEX"
              onclick={() => onJumpToOffset?.(parseInt(s.offset, 16))}
            >
              <td>{s.idx}</td>
              <td class="name">{s.name || '—'}</td>
              <td>{s.kind}</td>
              <td class="addr">{s.addr}</td>
              <td class="addr">{s.offset}</td>
              <td class="num">{s.size}</td>
              <td>{s.flags}</td>
              <td class="bar">
                <span
                  class="bar-fill"
                  style="width: {Math.max(1, (Number(s.size) / maxSectionSize) * BAR_MAX)}px"
                ></span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else if tab === 'segments'}
      <table>
        <thead><tr><th>#</th><th>KIND</th><th>VADDR</th><th>OFF</th><th>FILESZ</th><th>MEMSZ</th><th>FLAGS</th></tr></thead>
        <tbody>
          {#each report.segments as s}
            <tr
              class="clickable"
              title="Jump to offset {s.offset} in HEX"
              onclick={() => onJumpToOffset?.(parseInt(s.offset, 16))}
            >
              <td>{s.idx}</td>
              <td>{s.kind}</td>
              <td class="addr">{s.vaddr}</td>
              <td class="addr">{s.offset}</td>
              <td class="num">{s.filesz}</td>
              <td class="num">{s.memsz}</td>
              <td>{s.flags}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else if tab === 'symbols'}
      <table>
        <thead><tr><th>NAME</th><th>BIND</th><th>KIND</th><th>VALUE</th><th>SIZE</th></tr></thead>
        <tbody>
          {#each report.symbols as s}
            <tr>
              <td class="name">{s.name}</td>
              <td>{s.bind}</td>
              <td>{s.kind}</td>
              <td class="addr">{s.value}</td>
              <td class="num">{s.size}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else if tab === 'strings'}
      <div class="strings-bar">
        <input
          class="strings-q"
          type="text"
          placeholder="filter…"
          bind:value={stringQ}
        />
        <span class="strings-ct">{filteredStrings.length} / {strings?.length ?? 0}</span>
      </div>
      <table class="strings-tbl">
        <thead><tr><th class="addr">OFFSET</th><th>TEXT</th></tr></thead>
        <tbody>
          {#each filteredStrings as s}
            <tr
              class="clickable"
              title="Jump to offset {hex(s.offset)} in HEX"
              onclick={() => onJumpToOffset?.(s.offset)}
            >
              <td class="addr">{hex(s.offset)}</td>
              <td class="str">{s.text}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>

<style>
  .wrap { display: flex; flex-direction: column; min-height: 0; gap: 10px; flex: 1; }
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
  .tab.active .ct { color: var(--mint-deep); }
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
  .kv dd.addr { color: var(--mint-deep); }
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
  td.name { color: var(--ink); }
  td.addr { color: var(--mint-deep); font-variant-numeric: tabular-nums; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tbody tr:hover { background: var(--mint-pale); }
  tr.clickable { cursor: pointer; }

  .bar-h { width: 90px; color: var(--rule) !important; }
  td.bar { width: 90px; padding-right: 0; }
  .bar-fill {
    display: inline-block;
    height: 6px;
    background: var(--mint-deep);
    vertical-align: middle;
    border-radius: 1px;
    transition: width var(--t-base);
  }

  .strings-bar {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 10px;
    gap: 12px;
  }
  .strings-q {
    flex: 1;
    font-family: inherit;
    font-size: 11px;
    background: var(--bg);
    color: var(--ink);
    border: 1px solid var(--rule);
    padding: 4px 8px;
    letter-spacing: 0.04em;
  }
  .strings-q:focus { outline: none; border-color: var(--mint-deep); }
  .strings-ct {
    font-size: 9px;
    letter-spacing: 0.12em;
    color: var(--muted);
    text-transform: uppercase;
    white-space: nowrap;
  }
  .strings-tbl td.str { white-space: pre; color: var(--ink); font-family: var(--mono); }
</style>
