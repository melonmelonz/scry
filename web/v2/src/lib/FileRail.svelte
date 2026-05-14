<script>
  // V2's left-side FILE / SIZE / FORMAT panel. Mirrors v1's filerail.js +
  // .s-rail styling exactly so the two engines read as one instrument.
  import { fmtSize } from './loadFile.js';

  let { file, format, parsing } = $props();
</script>

<aside class="s-rail">
  {#if parsing}
    <div class="row">
      <span class="l">Loading</span>
      <span class="v">reading…</span>
    </div>
  {:else if file}
    <div class="row">
      <span class="l">File</span>
      <span class="v" title={file.name}>{file.name}</span>
    </div>
    <div class="row">
      <span class="l">Size</span>
      <span class="v">{fmtSize(file.bytes.length)}</span>
    </div>
    <div class="row">
      <span class="l">Format</span>
      <span class="v">{format ? format.toUpperCase() : '—'}</span>
    </div>
  {:else}
    <div class="row">
      <span class="l">No file loaded</span>
      <span class="v"><span class="mint">·</span> drop or pick to begin</span>
    </div>
  {/if}
</aside>

<style>
  /* Mirrors v1 .s-rail in web/v1/css/components.css. Width 220px. */
  .s-rail {
    width: 220px;
    border-right: var(--r-thin);
    padding: 18px 16px;
    background: var(--tint-rail);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
  }
  .row { display: flex; flex-direction: column; gap: 2px; }
  .l {
    font-size: var(--fs-label);
    letter-spacing: var(--tr-bracket);
    color: var(--muted);
    text-transform: uppercase;
  }
  .v {
    font-size: var(--fs-chrome-2);
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .v .mint { color: var(--mint-deep); }
</style>
