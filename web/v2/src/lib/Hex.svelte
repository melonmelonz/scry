<script>
  // V2 HEX — virtualized hex viewer with DOM-pooled rows, keyboard nav,
  // dual flash (row + cell), binary detail, and entropy tooltips.
  import { onMount, onDestroy } from 'svelte';
  import { ensureWasm } from './wasm.js';

  let { bytes, format = 'unknown', jumpTo = null, followTarget = null } = $props();

  const ROW_HEIGHT = 20;
  const BYTES_PER_ROW = 16;
  const OVERSCAN = 6;
  const MAX_PHYSICAL_PX = 2_000_000;
  const FLASH_MS = 400;

  let scrollEl = $state(null);
  let sizerEl = $state(null);
  let viewportHeight = $state(400);
  let scrollTopVal = $state(0);
  let rowPool = [];
  let geom = { physicalPx: 0, scale: 1 };
  let viewportFrac = $state(0);

  let core = $state(null);
  let entropy = $state([]);
  let blockSize = $state(0);
  let gotoVal = $state('');
  let selectedOffset = $state(null);
  let hoveredField = $state(null);

  let flashOffset = $state(null);
  let flashUntil = $state(0);
  let flashTick = $state(0);

  // ─── Overlays ────────────────────────────────────
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

  // ─── Helpers ─────────────────────────────────────
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

  // ─── Virtual geometry ────────────────────────────
  function virtualGeometry(totalRows) {
    const naturalPx = Math.max(0, totalRows * ROW_HEIGHT);
    if (naturalPx <= MAX_PHYSICAL_PX) return { physicalPx: naturalPx, scale: 1 };
    return { physicalPx: MAX_PHYSICAL_PX, scale: naturalPx / MAX_PHYSICAL_PX };
  }

  function visibleRange() {
    const totalRows = Math.ceil((bytes?.length ?? 0) / BYTES_PER_ROW);
    if (totalRows === 0) return { start: 0, end: 0, topPx: 0 };
    const s = geom.scale;
    const virtualScrollTop = scrollTopVal * s;
    const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
    const rawStart = Math.floor(virtualScrollTop / ROW_HEIGHT) - OVERSCAN;
    const start = Math.max(0, rawStart);
    const end = Math.min(totalRows, start + visibleCount);
    let topPx;
    if (s === 1) {
      topPx = start * ROW_HEIGHT;
    } else {
      const remainder = virtualScrollTop - start * ROW_HEIGHT;
      topPx = scrollTopVal - remainder / s;
    }
    return { start, end, topPx };
  }

  function ensurePool(n) {
    while (rowPool.length < n) {
      const r = document.createElement('div');
      r.className = 'hex-row';
      r.style.position = 'absolute';
      r.style.left = '0';
      r.style.right = '0';
      r.style.height = `${ROW_HEIGHT}px`;
      rowPool.push(r);
    }
  }

  function buildRowDOM(rowIdx) {
    const startByte = rowIdx * BYTES_PER_ROW;
    const endByte = Math.min(bytes.length, startByte + BYTES_PER_ROW);

    const addr = document.createElement('span');
    addr.className = 'addr';
    addr.textContent = hex8(startByte);

    const bytesSpan = document.createElement('span');
    bytesSpan.className = 'bytes';
    const asciiSpan = document.createElement('span');
    asciiSpan.className = 'ascii';

    for (let i = startByte; i < endByte; i++) {
      const v = bytes[i];
      const f = fieldAt(i);

      const byteBtn = document.createElement('button');
      byteBtn.type = 'button';
      byteBtn.className = 'byte';
      if (f) byteBtn.classList.add('ovr');
      if (hoveredField && f === hoveredField) byteBtn.classList.add('hot');
      if (selectedOffset === i) byteBtn.classList.add('sel');
      byteBtn.dataset.fi = String(i);
      byteBtn.textContent = hex2(v);

      const charBtn = document.createElement('button');
      charBtn.type = 'button';
      charBtn.className = 'char';
      if (f) charBtn.classList.add('ovr');
      if (hoveredField && f === hoveredField) charBtn.classList.add('hot');
      if (selectedOffset === i) charBtn.classList.add('sel');
      charBtn.dataset.fi = String(i);
      charBtn.textContent = asciiCh(v);

      bytesSpan.appendChild(byteBtn);
      asciiSpan.appendChild(charBtn);

      if (i - startByte === 7) {
        const mid = document.createElement('span');
        mid.className = 'wide';
        mid.textContent = ' ';
        bytesSpan.appendChild(mid);
      }
      if (i < endByte - 1) {
        bytesSpan.appendChild(document.createTextNode(' '));
      }
    }
    return [addr, bytesSpan, asciiSpan];
  }

  function render() {
    if (!bytes || !sizerEl) return;
    const totalRows = Math.ceil(bytes.length / BYTES_PER_ROW);
    geom = virtualGeometry(totalRows);
    sizerEl.style.height = `${geom.physicalPx}px`;

    const range = visibleRange();
    const count = range.end - range.start;
    ensurePool(count);

    for (let i = count; i < rowPool.length; i++) {
      if (rowPool[i].parentNode) rowPool[i].remove();
    }

    for (let i = 0; i < count; i++) {
      const rowIdx = range.start + i;
      const node = rowPool[i];
      node.style.top = `${range.topPx + i * ROW_HEIGHT}px`;
      node.dataset.row = String(rowIdx);
      node.dataset.rowOff = String(rowIdx * BYTES_PER_ROW);
      node.replaceChildren(...buildRowDOM(rowIdx));
      if (node.parentNode !== sizerEl) sizerEl.appendChild(node);
    }
    updateEntropyMarker();
  }

  function updateEntropyMarker() {
    if (bytes && bytes.length) {
      const virtualY = scrollTopVal * (geom.scale || 1);
      const firstByte = Math.floor(virtualY / ROW_HEIGHT) * BYTES_PER_ROW;
      viewportFrac = Math.max(0, Math.min(1, firstByte / Math.max(1, bytes.length)));
    } else {
      viewportFrac = 0;
    }
  }

  // ─── Scroll-to + flash ──────────────────────────
  function scrollToOffset(o, flash = true) {
    if (!bytes || !bytes.length || !scrollEl) return;
    const clamped = Math.max(0, Math.min(bytes.length - 1, Number(o) | 0));
    const targetRow = Math.floor(clamped / BYTES_PER_ROW);
    const thirdOffset = Math.max(0, Math.floor(viewportHeight / 3));
    const virtualTargetTop = targetRow * ROW_HEIGHT;
    const top = Math.max(0, (virtualTargetTop - thirdOffset) / (geom.scale || 1));
    try {
      scrollEl.scrollTo({ top, behavior: 'smooth' });
    } catch (_) {
      scrollEl.scrollTop = top;
    }
    if (flash) {
      flashOffset = targetRow * BYTES_PER_ROW;
      flashUntil = performance.now() + FLASH_MS;
      flashTick++;
      requestAnimationFrame(() => requestAnimationFrame(doFlash));
    }
  }

  function doFlash() {
    if (flashOffset == null) return;
    const startRow = Math.floor(flashOffset / BYTES_PER_ROW);
    rowPool.forEach(node => {
      const r = Number(node.dataset.row);
      if (r === startRow) {
        node.classList.remove('flash');
        void node.offsetWidth;
        node.classList.add('flash');
        setTimeout(() => node.classList.remove('flash'), 480);
      }
    });
    const endByte = flashOffset + BYTES_PER_ROW;
    if (sizerEl) {
      const cells = sizerEl.querySelectorAll('[data-fi]');
      cells.forEach(cell => {
        const fi = Number(cell.dataset.fi);
        if (fi >= flashOffset && fi < endByte) {
          cell.classList.remove('flash');
          void cell.offsetWidth;
          cell.classList.add('flash');
          setTimeout(() => cell.classList.remove('flash'), 480);
        }
      });
    }
    flashOffset = null;
  }

  // ─── Keyboard nav ───────────────────────────────
  function onKeydown(e) {
    if (!bytes?.length) return;
    const page = Math.max(1, Math.floor(viewportHeight / ROW_HEIGHT) - 2);
    const stepRow = (rows) => {
      const virtualY = scrollTopVal * (geom.scale || 1);
      const newVirtualY = Math.max(0, virtualY + rows * ROW_HEIGHT);
      scrollEl.scrollTop = newVirtualY / (geom.scale || 1);
    };
    if (e.key === 'PageDown') { e.preventDefault(); stepRow(page); }
    else if (e.key === 'PageUp') { e.preventDefault(); stepRow(-page); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); stepRow(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); stepRow(-1); }
    else if (e.key === 'Home') { e.preventDefault(); scrollEl.scrollTop = 0; }
    else if (e.key === 'End') { e.preventDefault(); scrollEl.scrollTop = geom.physicalPx; }
  }

  // ─── Grid event handlers ────────────────────────
  function onGridClick(e) {
    const t = e.target.closest('[data-fi]');
    if (!t) return;
    selectedOffset = Number(t.dataset.fi);
    render();
  }

  function onGridHover(e) {
    const t = e.target.closest('.ovr');
    if (!t) return;
    const fi = Number(t.dataset.fi);
    const f = fieldAt(fi);
    if (f && f !== hoveredField) {
      hoveredField = f;
      render();
    }
  }

  function onGridLeave() {
    if (hoveredField) { hoveredField = null; render(); }
  }

  // ─── GOTO form ──────────────────────────────────
  function gotoOffset(e) {
    e.preventDefault();
    let v = gotoVal.trim();
    if (!v) return;
    if (v.startsWith('0x') || v.startsWith('0X')) v = v.slice(2);
    const n = parseInt(v, 16);
    if (!Number.isFinite(n)) return;
    scrollToOffset(n, true);
  }

  // ─── Entropy click ──────────────────────────────
  function clickEntropy(e) {
    if (!entropy.length || !bytes) return;
    const strip = e.currentTarget;
    const rect = strip.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const target = Math.floor(frac * bytes.length);
    scrollToOffset(target, true);
  }

  // ─── Byte detail (with binary) ──────────────────
  function byteDetail() {
    if (!bytes || selectedOffset == null || selectedOffset < 0 || selectedOffset >= bytes.length) return null;
    const v = bytes[selectedOffset];
    const bin = v.toString(2).padStart(8, '0');
    const u16 = selectedOffset + 1 < bytes.length ? (bytes[selectedOffset] | (bytes[selectedOffset + 1] << 8)) : null;
    const u32 = selectedOffset + 3 < bytes.length
      ? ((bytes[selectedOffset] | (bytes[selectedOffset + 1] << 8) | (bytes[selectedOffset + 2] << 16) | (bytes[selectedOffset + 3] << 24)) >>> 0)
      : null;
    const parts = [`OFF ${hex8(selectedOffset)}`, `BYTE 0x${hex2(v)} (${v})`, `b${bin}`, `ASCII '${asciiCh(v)}'`];
    if (u16 !== null) parts.push(`U16LE 0x${u16.toString(16).toUpperCase().padStart(4, '0')}`);
    if (u32 !== null) parts.push(`U32LE 0x${u32.toString(16).toUpperCase().padStart(8, '0')}`);
    return parts.join(' \u00B7 ');
  }

  // ─── Mount / lifecycle ──────────────────────────
  let scrollRaf = 0;
  let ro;

  let scrollHandler;

  onMount(() => {
    ro = new ResizeObserver(() => {
      viewportHeight = scrollEl.clientHeight;
      render();
    });
    ro.observe(scrollEl);
    scrollHandler = () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        scrollTopVal = scrollEl.scrollTop;
        render();
      });
    };
    scrollEl.addEventListener('scroll', scrollHandler, { passive: true });
    render();
  });
  onDestroy(() => {
    try { ro?.disconnect(); } catch (_) {}
    if (scrollEl && scrollHandler) scrollEl.removeEventListener('scroll', scrollHandler);
  });

  // ─── Effects ────────────────────────────────────

  // WASM + entropy
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

  // Bytes changed — guard against re-running when only `core` changes
  let lastBytes = null;
  $effect(() => {
    const b = bytes;
    if (b === lastBytes) return;
    lastBytes = b;
    if (scrollEl) scrollEl.scrollTop = 0;
    scrollTopVal = 0;
    selectedOffset = null;
    hoveredField = null;
    rowPool = [];
    if (core) {
      blockSize = Math.max(64, Math.ceil((b?.length ?? 0) / 256));
      entropy = b ? core.entropy_blocks(b, blockSize) : [];
    }
    render();
  });

  // Format changed
  $effect(() => {
    void format;
    render();
  });

  // Jump-to from external
  $effect(() => {
    if (jumpTo == null) return;
    const target = typeof jumpTo === 'object' ? jumpTo.o : jumpTo;
    scrollToOffset(target, true);
  });

  // Follow target (PC tracking)
  let lastFollowRow = -1;
  $effect(() => {
    const f = followTarget;
    if (!f || typeof f.offset !== 'number') {
      lastFollowRow = -1;
      return;
    }
    const row = Math.floor(f.offset / BYTES_PER_ROW);
    if (row === lastFollowRow) return;
    lastFollowRow = row;
    scrollToOffset(f.offset, false);
  });
</script>

<div class="wrap">
  <div class="bar">
    <span class="ti">[ HEX ]</span>
    <div class="ctl">
      <form class="goto" onsubmit={gotoOffset}>
        <span class="at">GOTO</span>
        <input
          type="text"
          bind:value={gotoVal}
          placeholder="0x00000000"
          aria-label="Jump to hex offset"
        />
      </form>
    </div>
  </div>

  {#if entropy.length > 1}
    <div class="strip-wrap">
      <span class="strip-label">ENTROPY</span>
      <div class="strip" onclick={clickEntropy} role="presentation" title="Click to jump">
        {#each entropy as e, i}
          <span class="strip-col"
            style="height: {Math.max(2, e * 100)}%; opacity: {0.35 + e * 0.65}"
            title="block {i} \u00B7 offset 0x{(Math.floor(i * (bytes?.length ?? 0) / entropy.length)).toString(16).toUpperCase()} \u00B7 entropy {e.toFixed(1)} bits"
          ></span>
        {/each}
        <span class="strip-cursor" style="left: {viewportFrac * 100}%"></span>
      </div>
      <span class="strip-scale">{blockSize.toLocaleString()} B / col</span>
    </div>
  {/if}

  <div class="grid" bind:this={scrollEl} tabindex="0" role="grid"
    onkeydown={onKeydown}
    onclick={onGridClick}
    onmouseover={onGridHover}
    onmouseleave={onGridLeave}
    onfocus={onGridHover}>
    <div class="sizer" bind:this={sizerEl}></div>
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
  .strip-col:hover {
    background: var(--mint-deep);
    box-shadow: 0 0 6px var(--mint-deep);
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
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
    border: 1px solid var(--rule);
    background: var(--paper);
    padding: 8px 0;
    font-size: 11px;
    line-height: 20px;
    font-family: var(--mono);
    position: relative;
  }
  .grid:focus { outline: 2px solid var(--mint-deep); outline-offset: -2px; }

  .sizer { position: relative; width: 100%; }

  :global(.hex-row) {
    display: grid;
    grid-template-columns: 100px 1fr 170px;
    gap: 22px;
    padding: 0 12px;
    align-items: center;
    min-height: 20px;
    white-space: nowrap;
    transition: background 80ms ease;
  }
  :global(.hex-row:hover) { background: var(--tint-row); }
  :global(.hex-row.flash) {
    background: var(--tint-drop);
    transition: background 400ms ease;
  }

  @keyframes hex-cell-flash {
    from { background: var(--tint-drop); }
    to   { background: transparent; }
  }

  :global(.hex-row .addr) { color: var(--muted); }
  :global(.hex-row .bytes) { letter-spacing: 0.04em; }
  :global(.hex-row .byte),
  :global(.hex-row .char) {
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
  :global(.hex-row .byte.ovr),
  :global(.hex-row .char.ovr) { background: var(--mint-pale); }
  :global(.hex-row .byte.hot),
  :global(.hex-row .char.hot),
  :global(.hex-row .byte:hover),
  :global(.hex-row .char:hover) { background: var(--mint); color: var(--ink); }
  :global(.hex-row .byte.sel),
  :global(.hex-row .char.sel) { background: var(--mint-deep); color: var(--paper); }
  :global(.hex-row .byte.flash),
  :global(.hex-row .char.flash) {
    animation: hex-cell-flash 400ms ease forwards;
  }
  :global(.hex-row .ascii) { color: var(--muted); }
  :global(.hex-row .ascii .char.ovr) { color: var(--ink); }
  :global(.hex-row .wide) { display: inline-block; width: 8px; }

  :global(.hex-row .byte.sel),
  :global(.hex-row .char.sel) {
    animation: byte-pop 200ms ease-out;
  }

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
  :global(.hex-row .byte.pc-active),
  :global(.hex-row .char.pc-active) {
    outline: 2px solid var(--mint-deep);
    outline-offset: -1px;
    animation: pc-pulse 1.2s ease-in-out infinite;
  }
  @keyframes byte-pop {
    0%  { transform: scale(1); }
    40% { transform: scale(1.3); }
    100% { transform: scale(1); }
  }
</style>
