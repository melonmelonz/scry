<script>
  // CART pane — V2's take on a GBA cartridge. V1 runs the game (via
  // vendored gbajs); V2 dissects the header structurally in Rust and
  // shows the bytes that produced the verdict. Different story, same
  // file — this is the comparison V2 is supposed to make.
  import { ensureWasm } from './wasm.js';

  let { bytes } = $props();

  let header = $state(null);
  let error  = $state('');

  function hex2(n) { return (n >>> 0).toString(16).padStart(2, '0').toUpperCase(); }
  function hex8(n) { return '0x' + (n >>> 0).toString(16).padStart(8, '0').toUpperCase(); }
  function asciiCh(n) { return (n >= 0x20 && n <= 0x7E) ? String.fromCharCode(n) : '.'; }

  function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024*1024) return `${(n/1024).toFixed(1)} KiB`;
    return `${(n/1024/1024).toFixed(2)} MiB`;
  }

  async function parse(b) {
    error = '';
    if (!b) { header = null; return; }
    try {
      const core = await ensureWasm();
      header = core.parse_gba(b);
    } catch (e) {
      console.error('[scry/cart] parse failed', e);
      header = null;
      error = String(e?.message || e);
    }
  }

  $effect(() => {
    const b = bytes;
    parse(b);
  });

  // Render a window of bytes as hex+ascii rows. Used for the header
  // dump in the right column.
  function row(off) {
    if (!bytes) return null;
    const slice = bytes.subarray(off, Math.min(bytes.length, off + 16));
    const hexs = [];
    const asc  = [];
    for (let i = 0; i < slice.length; i++) {
      hexs.push(hex2(slice[i]));
      asc.push(asciiCh(slice[i]));
      if (i === 7) hexs.push('');
    }
    return { off, hex: hexs.join(' ').replace(/  /g, '  '), ascii: asc.join('') };
  }

  let headerRows = $derived.by(() => {
    if (!bytes) return [];
    const out = [];
    for (let off = 0xA0; off < 0xE0; off += 16) {
      const r = row(off);
      if (r) out.push(r);
    }
    return out;
  });
</script>

<div class="c-wrap">
  <div class="c-bar">
    <span class="c-title">[ GBA / CARTRIDGE ]</span>
    {#if header}
      <span class="c-meta">"{header.title || '(blank)'}" &middot; {header.game_code} &middot; {fmtBytes(header.rom_size)}</span>
    {/if}
  </div>

  {#if error}
    <div class="c-empty">parse failed: {error}</div>
  {:else if !header}
    <div class="c-empty">Parsing…</div>
  {:else}
    <div class="c-split">
      <div class="c-col">
        <div class="c-section-title">[ DECODED HEADER ]</div>
        <div class="c-row"><span class="l">TITLE</span><span class="v">{header.title || '(blank)'}</span></div>
        <div class="c-row"><span class="l">GAME CODE</span><span class="v">{header.game_code || '----'}</span></div>
        <div class="c-row"><span class="l">MAKER</span><span class="v">{header.maker_code || '--'}</span></div>
        <div class="c-row">
          <span class="l">FIXED</span>
          <span class="v">0x{hex2(header.fixed)} {header.fixed_ok ? '\u2713' : '\u2717'}</span>
        </div>
        <div class="c-row"><span class="l">UNIT CODE</span><span class="v">0x{hex2(header.unit_code)}</span></div>
        <div class="c-row"><span class="l">DEVICE</span><span class="v">0x{hex2(header.device_type)}</span></div>
        <div class="c-row"><span class="l">VERSION</span><span class="v">0x{hex2(header.version)}</span></div>
        <div class="c-row">
          <span class="l">CHECKSUM</span>
          <span class="v">
            stored 0x{hex2(header.checksum)} &middot;
            computed 0x{hex2(header.checksum_computed)}
            {header.checksum_ok ? ' \u2713' : ' \u2717'}
          </span>
        </div>
        <div class="c-row"><span class="l">SIZE</span><span class="v">{fmtBytes(header.rom_size)}</span></div>

        <p class="c-note">
          V2 parses GBA cartridges in Rust (<code>scry-core::parse_gba</code>) and verifies the
          one-byte Nintendo header checksum (sum bytes 0xA0..=0xBC, negate, subtract 0x19).
          Emulation lives in V1's GAME pane (vendored <code>gbajs</code>); the V2 port is on the roadmap.
        </p>
      </div>

      <div class="c-col">
        <div class="c-section-title">[ HEADER BYTES 0xA0\u20130xDF ]</div>
        <div class="c-hex">
          {#each headerRows as r}
            <div class="c-hex-row">
              <span class="addr">{hex8(r.off)}</span>
              <span class="bytes">{r.hex}</span>
              <span class="ascii">{r.ascii}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .c-wrap {
    display: flex; flex-direction: column;
    height: 100%; padding: 0 22px 22px;
    min-height: 0;
  }
  .c-bar {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 18px; padding: 16px 0 12px;
    border-bottom: 1px solid var(--grey);
  }
  .c-title { font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
  .c-meta  { font-size: 10px; color: var(--mint-deep); letter-spacing: 0.08em; }

  .c-empty { padding: 28px 0; color: var(--muted); font-size: 11px; font-style: italic; }

  .c-split {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 28px;
    padding: 18px 0 0;
    min-height: 0;
    overflow: auto;
  }
  .c-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .c-section-title {
    font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--muted); margin-bottom: 6px;
  }
  .c-row { display: flex; gap: 12px; align-items: baseline; font-size: 11px; letter-spacing: 0.02em; }
  .c-row .l { width: 92px; flex-shrink: 0; font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
  .c-row .v { color: var(--ink); font-variant-numeric: tabular-nums; }

  .c-note {
    margin-top: 18px;
    font-size: 10px;
    color: var(--muted);
    font-style: italic;
    line-height: 1.6;
  }
  .c-note code { font-style: normal; color: var(--ink-dim); }

  .c-hex { display: flex; flex-direction: column; gap: 2px; }
  .c-hex-row {
    display: grid;
    grid-template-columns: 92px 1fr 160px;
    gap: 14px;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    line-height: 1.4;
  }
  .c-hex-row .addr  { color: var(--muted); }
  .c-hex-row .bytes { color: var(--ink); white-space: pre; }
  .c-hex-row .ascii { color: var(--ink-dim); white-space: pre; }

  @media (max-width: 900px) {
    .c-split { grid-template-columns: 1fr; }
  }
</style>
