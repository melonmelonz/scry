<script>
  // V2 HEX keeps the wasm-backed entropy strip, but rows are rendered as
  // individual byte cells so the pane can inspect bytes and fields like v1.
  import { ensureWasm } from './wasm.js';

  let { bytes, format = 'unknown', jumpTo = null, followTarget = null } = $props();

  let offset = $state(0);
  const PAGE = 16 * 32;

  let rows = $state([]);
  let core = $state(null);
  let entropy = $state([]);
  let blockSize = $state(0);
  let gotoVal = $state('');
  let selectedOffset = $state(null);
  let hoveredField = $state(null);
  let hoveredRow = $state(null);

  let flashOffset = $state(null);
  let flashUntil = $state(0);
  let flashTick = $state(0);
  const FLASH_MS = 400;

  let gridEl = $state(null);

  const ELF32_HEADER_OVERLAY = [
    { offset: 0x00, size: 4, name: 'e_ident.magic', type: 'u32be', description: 'ELF magic (0x7F ELF)' },
    { offset: 0x04, size: 1, name: 'e_ident.class', type: 'u8', description: '1 = 32-bit, 2 = 64-bit' },
    { offset: 0x05, size: 1, name: 'e_ident.data', type: 'u8', description: '1 = little-endian, 2 = big-endian' },
    { offset: 0x06, size: 1, name: 'e_ident.version', type: 'u8' },
    { offset: 0x07, size: 1, name: 'e_ident.osabi', type: 'u8' },
    { offset: 0x08, size: 1, name: 'e_ident.abiversion', type: 'u8' },
    { offset: 0x09, size: 7, name: 'e_ident.pad', type: 'bytes' },
    { offset: 0x10, size: 2, name: 'e_type', type: 'u16', description: '2 = EXEC, 3 = DYN' },
    { offset: 0x12, size: 2, name: 'e_machine', type: 'u16', description: '243 = RISC-V, 62 = x86_64' },
    { offset: 0x14, size: 4, name: 'e_version', type: 'u32' },
    { offset: 0x18, size: 4, name: 'e_entry', type: 'u32', description: 'Entry-point virtual address' },
    { offset: 0x1C, size: 4, name: 'e_phoff', type: 'u32' },
    { offset: 0x20, size: 4, name: 'e_shoff', type: 'u32' },
    { offset: 0x24, size: 4, name: 'e_flags', type: 'u32' },
    { offset: 0x28, size: 2, name: 'e_ehsize', type: 'u16' },
    { offset: 0x2A, size: 2, name: 'e_phentsize', type: 'u16' },
    { offset: 0x2C, size: 2, name: 'e_phnum', type: 'u16' },
    { offset: 0x2E, size: 2, name: 'e_shentsize', type: 'u16' },
    { offset: 0x30, size: 2, name: 'e_shnum', type: 'u16' },
    { offset: 0x32, size: 2, name: 'e_shstrndx', type: 'u16' },
  ];

  const GBA_HEADER_OVERLAY = [
    { offset: 0x000, size: 4, name: 'entry.branch', type: 'bytes', description: 'ARM branch executed by the BIOS after header validation' },
    { offset: 0x004, size: 156, name: 'nintendo.logo', type: 'bytes', description: 'Fixed Nintendo logo bitmap checked by boot ROM' },
    { offset: 0x0A0, size: 12, name: 'game.title', type: 'string', description: 'ASCII cartridge title' },
    { offset: 0x0AC, size: 4, name: 'game.code', type: 'string', description: 'Four-character game code' },
    { offset: 0x0B0, size: 2, name: 'maker.code', type: 'string', description: 'Two-character maker code' },
    { offset: 0x0B2, size: 1, name: 'fixed.0x96', type: 'u8', description: 'Fixed value required by the GBA BIOS' },
    { offset: 0x0B3, size: 1, name: 'unit.code', type: 'u8', description: 'Usually 0x00 for GBA' },
    { offset: 0x0B4, size: 1, name: 'device.type', type: 'u8', description: 'Device type / debug field' },
    { offset: 0x0B5, size: 7, name: 'reserved', type: 'bytes' },
    { offset: 0x0BC, size: 1, name: 'software.version', type: 'u8' },
    { offset: 0x0BD, size: 1, name: 'complement.checksum', type: 'u8', description: 'Header checksum over bytes 0xA0..0xBC' },
    { offset: 0x0BE, size: 2, name: 'reserved.tail', type: 'bytes' },
  ];

  function hex2(n) { return (n >>> 0).toString(16).padStart(2, '0').toUpperCase(); }
  function hex8(n) { return '0x' + (n >>> 0).toString(16).padStart(8, '0').toUpperCase(); }
  function asciiCh(n) { return (n >= 0x20 && n <= 0x7E) ? String.fromCharCode(n) : '.'; }

  function activeOverlay() {
    if (format === 'elf') return ELF32_HEADER_OVERLAY;
    if (format === 'gba') return GBA_HEADER_OVERLAY;
    return [];
  }

  function fieldAt(off) {
    for (const f of activeOverlay()) {
      if (off >= f.offset && off < f.offset + f.size) return f;
    }
    return null;
  }

  function readField(f) {
    if (!bytes || f.offset + f.size > bytes.byteLength) return '-';
    if (f.type === 'string') {
      return Array.from(bytes.subarray(f.offset, f.offset + f.size))
        .map((b) => (b >= 0x20 && b <= 0x7E ? String.fromCharCode(b) : '.'))
        .join('')
        .trim();
    }
    if (f.type === 'u8') return `0x${hex2(bytes[f.offset])} (${bytes[f.offset]})`;
    if (f.type === 'u16') {
      const v = bytes[f.offset] | (bytes[f.offset + 1] << 8);
      return `0x${v.toString(16).toUpperCase().padStart(4, '0')} (${v})`;
    }
    if (f.type === 'u32' || f.type === 'u32be') {
      const v = f.type === 'u32be'
        ? (((bytes[f.offset] << 24) | (bytes[f.offset + 1] << 16) | (bytes[f.offset + 2] << 8) | bytes[f.offset + 3]) >>> 0)
        : ((bytes[f.offset] | (bytes[f.offset + 1] << 8) | (bytes[f.offset + 2] << 16) | (bytes[f.offset + 3] << 24)) >>> 0);
      return `0x${v.toString(16).toUpperCase().padStart(8, '0')} (${v})`;
    }
    return Array.from(bytes.subarray(f.offset, f.offset + f.size)).map(hex2).join(' ');
  }

  function buildRows() {
    if (!bytes) return [];
    const end = Math.min(bytes.byteLength, offset + PAGE);
    const out = [];
    for (let rowOff = offset; rowOff < end; rowOff += 16) {
      const rowEnd = Math.min(bytes.byteLength, rowOff + 16);
      const cells = [];
      const ascii = [];
      for (let off = rowOff; off < rowEnd; off++) {
        const f = fieldAt(off);
        cells.push({ off, value: bytes[off], hex: hex2(bytes[off]), field: f, gap: off - rowOff === 7 ? 'wide' : '' });
        ascii.push({ off, ch: asciiCh(bytes[off]), field: f });
      }
      out.push({ off: rowOff, cells, ascii });
    }
    return out;
  }

  function render() {
    rows = buildRows();
  }

  $effect(() => {
    let cancelled = false;
    ensureWasm().then((c) => {
      if (cancelled) return;
      core = c;
      const target = 256;
      blockSize = Math.max(64, Math.ceil((bytes?.length ?? 0) / target));
      entropy = bytes ? core.entropy_blocks(bytes, blockSize) : [];
      render();
    });
    return () => { cancelled = true; };
  });

  $effect(() => {
    const b = bytes;
    offset = 0;
    selectedOffset = null;
    hoveredField = null;
    render();
    if (core) {
      blockSize = Math.max(64, Math.ceil((b?.length ?? 0) / 256));
      entropy = b ? core.entropy_blocks(b, blockSize) : [];
    }
  });

  $effect(() => {
    const f = format;
    void f;
    render();
  });

  function scrollToOffset(o, flash = true) {
    if (!bytes || !bytes.length) return;
    const clamped = Math.max(0, Math.min(bytes.length - 1, Number(o) | 0));
    const rowStart = Math.floor(clamped / 16) * 16;
    const pageStart = Math.floor(rowStart / PAGE) * PAGE;
    offset = pageStart;
    render();
    if (flash) {
      flashOffset = rowStart;
      flashUntil = performance.now() + FLASH_MS;
      flashTick++;
    }
    requestAnimationFrame(() => {
      if (!gridEl) return;
      const node = gridEl.querySelector(`[data-row-off="${rowStart}"]`);
      if (!node) return;
      const gridRect = gridEl.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      const targetOffset = nodeRect.top - gridRect.top - gridRect.height / 3;
      gridEl.scrollTo({ top: gridEl.scrollTop + targetOffset, behavior: 'smooth' });
    });
  }

  $effect(() => {
    if (jumpTo == null) return;
    const target = typeof jumpTo === 'object' ? jumpTo.o : jumpTo;
    scrollToOffset(target, true);
  });

  let lastFollowRow = -1;
  $effect(() => {
    const f = followTarget;
    if (!f || typeof f.offset !== 'number') {
      lastFollowRow = -1;
      return;
    }
    const row = Math.floor(f.offset / 16);
    if (row === lastFollowRow) return;
    lastFollowRow = row;
    scrollToOffset(f.offset, false);
  });

  $effect(() => {
    if (flashTick === 0) return;
    let raf = 0;
    const loop = () => {
      if (performance.now() >= flashUntil) {
        flashOffset = null;
        return;
      }
      flashTick = (flashTick + 1) & 0xfff;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });

  function move(d) {
    offset = Math.max(0, Math.min((bytes?.length ?? 0) - 1, offset + d));
    offset = Math.floor(offset / 16) * 16;
    render();
  }

  function gotoOffset(e) {
    e.preventDefault();
    let v = gotoVal.trim();
    if (!v) return;
    if (v.startsWith('0x') || v.startsWith('0X')) v = v.slice(2);
    const n = parseInt(v, 16);
    if (!Number.isFinite(n)) return;
    scrollToOffset(n, true);
  }

  function clickEntropy(e) {
    if (!entropy.length || !bytes) return;
    const strip = e.currentTarget;
    const rect = strip.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const target = Math.floor(frac * bytes.length);
    scrollToOffset(target, true);
  }

  function byteDetail() {
    if (!bytes || selectedOffset == null || selectedOffset < 0 || selectedOffset >= bytes.length) return null;
    const v = bytes[selectedOffset];
    const u16 = selectedOffset + 1 < bytes.length ? (bytes[selectedOffset] | (bytes[selectedOffset + 1] << 8)) : null;
    const u32 = selectedOffset + 3 < bytes.length
      ? ((bytes[selectedOffset] | (bytes[selectedOffset + 1] << 8) | (bytes[selectedOffset + 2] << 16) | (bytes[selectedOffset + 3] << 24)) >>> 0)
      : null;
    const parts = [`OFF ${hex8(selectedOffset)}`, `BYTE 0x${hex2(v)} (${v})`, `ASCII '${asciiCh(v)}'`];
    if (u16 !== null) parts.push(`U16LE 0x${u16.toString(16).toUpperCase().padStart(4, '0')}`);
    if (u32 !== null) parts.push(`U32LE 0x${u32.toString(16).toUpperCase().padStart(8, '0')}`);
    return parts.join(' \u00B7 ');
  }

  let viewportFrac = $derived(bytes && bytes.length ? offset / bytes.length : 0);

  function flashAlphaFor(rowOff, _tick) {
    if (flashOffset == null || rowOff !== flashOffset) return 0;
    const remaining = flashUntil - performance.now();
    if (remaining <= 0) return 0;
    return remaining / FLASH_MS;
  }
</script>

<div class="wrap">
  <div class="bar">
    <span class="ti">[ HEX ]</span>
    <div class="ctl">
      <button onclick={() => move(-PAGE)}>&#9664; PAGE</button>
      <button onclick={() => move(-16)}>&#9650; ROW</button>
      <form class="goto" onsubmit={gotoOffset}>
        <span class="at">@</span>
        <input
          type="text"
          bind:value={gotoVal}
          placeholder={offset.toString(16).padStart(8, '0').toUpperCase()}
          aria-label="Jump to hex offset"
        />
      </form>
      <button onclick={() => move(16)}>&#9660; ROW</button>
      <button onclick={() => move(PAGE)}>PAGE &#9654;</button>
    </div>
  </div>

  {#if entropy.length > 1}
    <div class="strip-wrap">
      <span class="strip-label">ENTROPY</span>
      <div class="strip" onclick={clickEntropy} role="presentation" title="Click to jump">
        {#each entropy as e}
          <span class="strip-col" style="height: {Math.max(2, e * 100)}%; opacity: {0.35 + e * 0.65}"></span>
        {/each}
        <span class="strip-cursor" style="left: {viewportFrac * 100}%"></span>
      </div>
      <span class="strip-scale">{blockSize.toLocaleString()} B / col</span>
    </div>
  {/if}

  <div class="grid" bind:this={gridEl}>
    {#each rows as r, i}
      <div
        class="hex-row"
        role="presentation"
        class:hover={hoveredRow === i}
        class:flash={r.off === flashOffset}
        data-row-off={r.off}
        style={r.off === flashOffset ? `--flash-a: ${flashAlphaFor(r.off, flashTick)}` : ''}
        onmouseenter={() => (hoveredRow = i)}
        onmouseleave={() => (hoveredRow === i && (hoveredRow = null))}
      >
        <span class="addr">{hex8(r.off)}</span>
        <span class="bytes">
          {#each r.cells as c, ci}
            <button
              type="button"
              class="byte"
              class:ovr={!!c.field}
              class:hot={hoveredField && c.field === hoveredField}
              class:sel={selectedOffset === c.off}
              title={c.field ? c.field.name : `offset ${hex8(c.off)}`}
              onclick={() => (selectedOffset = c.off)}
              onmouseenter={() => (hoveredField = c.field)}
              onmouseleave={() => (hoveredField === c.field && (hoveredField = null))}
            >{c.hex}</button>{#if ci < r.cells.length - 1}<span class:wide={c.gap === 'wide'}> </span>{/if}
          {/each}
        </span>
        <span class="ascii">
          {#each r.ascii as c}
            <button
              type="button"
              class="char"
              class:ovr={!!c.field}
              class:hot={hoveredField && c.field === hoveredField}
              class:sel={selectedOffset === c.off}
              onclick={() => (selectedOffset = c.off)}
              onmouseenter={() => (hoveredField = c.field)}
              onmouseleave={() => (hoveredField === c.field && (hoveredField = null))}
            >{c.ch}</button>
          {/each}
        </span>
      </div>
    {/each}
  </div>

  <div class="detail">
    {#if hoveredField}
      <div class="field">
        <span class="d-l">FIELD</span>
        <span class="d-v strong">{hoveredField.name}</span>
        <span class="d-l">OFFSET</span>
        <span class="d-v">{hex8(hoveredField.offset)}</span>
        <span class="d-l">VALUE</span>
        <span class="d-v mint">{readField(hoveredField)}</span>
        {#if hoveredField.description}
          <span class="d-l">NOTE</span>
          <span class="d-v">{hoveredField.description}</span>
        {/if}
      </div>
    {:else}
      {byteDetail() ?? 'select a byte or hover a highlighted field'}
    {/if}
  </div>
</div>

<style>
  .wrap { display: flex; flex-direction: column; min-height: 0; gap: 8px; flex: 1; }
  .bar { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .ti {
    font-size: 10px;
    letter-spacing: 0.16em;
    color: var(--mint-deep);
    text-transform: uppercase;
  }
  .ctl { display: flex; gap: 6px; align-items: baseline; }
  .goto {
    display: inline-flex;
    align-items: baseline;
    border: 1px solid var(--rule);
    padding: 3px 6px;
    gap: 4px;
  }
  .goto:focus-within { border-color: var(--mint-deep); }
  .goto .at { color: var(--muted); font-size: 10px; }
  .goto input {
    font-family: inherit;
    font-size: 10px;
    color: var(--mint-deep);
    background: transparent;
    border: 0;
    outline: 0;
    width: 84px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .strip-wrap {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 10px;
    font-size: 9px;
    letter-spacing: 0.14em;
    color: var(--muted);
    text-transform: uppercase;
  }
  .strip {
    position: relative;
    height: 28px;
    display: flex;
    align-items: flex-end;
    gap: 1px;
    background: var(--paper);
    border: 1px solid var(--rule);
    padding: 2px;
    cursor: crosshair;
    overflow: hidden;
  }
  .strip-col {
    flex: 1 1 auto;
    min-width: 1px;
    background: var(--mint-deep);
  }
  .strip-cursor {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--accent-system);
    pointer-events: none;
    transition: left var(--t-fast);
  }
  .strip-label { color: var(--mint-deep); }
  .strip-scale { color: var(--muted); }

  .grid {
    flex: 1;
    overflow: auto;
    min-height: 0;
    border: 1px solid var(--rule);
    background: var(--paper);
    padding: 8px 0;
    font-size: 11px;
    line-height: 20px;
    font-family: var(--mono);
  }
  .hex-row {
    display: grid;
    grid-template-columns: 100px 1fr 170px;
    gap: 22px;
    padding: 0 12px;
    align-items: center;
    min-height: 20px;
    white-space: nowrap;
    transition: background 80ms ease;
  }
  .hex-row.hover { background: var(--tint-row); }
  .hex-row.flash {
    background: color-mix(in srgb, var(--tint-drop) calc(var(--flash-a, 0) * 100%), transparent);
  }
  .addr { color: var(--muted); }
  .bytes { letter-spacing: 0.04em; }
  .byte, .char {
    appearance: none;
    border: 0;
    background: transparent;
    color: inherit;
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    padding: 0 1px;
    cursor: pointer;
  }
  .byte.ovr, .char.ovr { background: var(--mint-pale); }
  .byte.hot, .char.hot, .byte:hover, .char:hover { background: var(--mint); color: var(--ink); }
  .byte.sel, .char.sel { background: var(--mint-deep); color: var(--paper); }
  .ascii { color: var(--muted); }
  .ascii .char.ovr { color: var(--ink); }
  .wide { display: inline-block; width: 8px; }

  .detail {
    min-height: 48px;
    border-left: 2px solid var(--mint-deep);
    background: var(--mint-pale);
    padding: 10px 14px;
    color: var(--muted);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .field {
    display: grid;
    grid-template-columns: 70px 1fr;
    gap: 3px 12px;
  }
  .d-l { color: var(--mint-deep); font-size: 9px; letter-spacing: 0.14em; }
  .d-v { color: var(--ink); text-transform: none; letter-spacing: 0.02em; }
  .d-v.strong { font-weight: 600; }
  .d-v.mint { color: var(--mint-deep); }

  @keyframes pc-pulse {
    0%, 100% { outline-color: var(--mint-deep); }
    50%      { outline-color: transparent; }
  }
  .byte.pc-active, .char.pc-active {
    outline: 2px solid var(--mint-deep);
    outline-offset: -1px;
    animation: pc-pulse 1.2s ease-in-out infinite;
  }
  .strip-col:hover {
    background: var(--mint-deep);
    box-shadow: 0 0 6px var(--mint-deep);
  }
  @keyframes byte-pop {
    0%  { transform: scale(1); }
    40% { transform: scale(1.3); }
    100% { transform: scale(1); }
  }
  .byte.sel, .char.sel {
    animation: byte-pop 200ms ease-out;
  }
</style>
