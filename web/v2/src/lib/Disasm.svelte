<script>
  // V2 DISASM — virtualized RV32 disassembly viewer with DOM-pooled rows.
  // Ported from v1's disasm.js. Uses imperative DOM for scroll rows (same
  // approach as Hex.svelte and MiniHex.svelte) and Svelte template for the
  // bar/controls.

  import { onMount, onDestroy, untrack } from 'svelte';
  import { parseElf } from '../../../v1/js/elf/parse.js';
  import { disassembleRange } from '../../../v1/js/disasm/rv32.js';

  let { bytes, format = 'unknown' } = $props();

  const ROW_HEIGHT = 22;
  const OVERSCAN = 6;
  const MAX_PHYSICAL_PX = 2_000_000;

  let scrollEl;
  let sizerEl;
  let viewportHeight = 400;
  let rowPool = [];
  let geom = { physicalPx: 0, scale: 1 };

  let elf = null;
  let textSection = null;
  let baseAddr = 0;
  let textOffset = 0;
  let textBytesLen = 0;
  let totalInstrs = 0;
  let symbols = new Map();
  let isRiscv = false;

  let warnText = $state('');
  let sectionText = $state('');
  let gotoVal = $state('');

  // ─── Helpers ─────────────────────────────────────
  function hex(n, w = 8) {
    return '0x' + ((n >>> 0).toString(16).toUpperCase()).padStart(w, '0');
  }

  function rawBytes4(word) {
    const b = [(word >>> 0) & 0xFF, (word >>> 8) & 0xFF, (word >>> 16) & 0xFF, (word >>> 24) & 0xFF];
    return b.map(v => v.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  }

  // ─── ELF analysis ───────────────────────────────
  function findTextSection(e) {
    let text = e.sections.find(s => s.name === '.text');
    if (!text) {
      text = e.sections.find(s =>
        s.sh_type === 1 && (Number(s.sh_flags) & 0x4) // SHF_EXECINSTR
      );
    }
    // Fall back to the first executable PT_LOAD segment (minimal ELFs with
    // no section headers, e.g. the hand-rolled demo samples).
    if (!text && e.segments) {
      const load = e.segments.find(s =>
        s.p_type === 1 && (Number(s.p_flags) & 0x1) // PT_LOAD + PF_X
      );
      if (load && Number(load.p_filesz) > 0) {
        text = {
          name: '(PT_LOAD)',
          sh_offset: Number(load.p_offset),
          sh_size:   Number(load.p_filesz),
          sh_addr:   Number(load.p_vaddr),
          sh_type:   1,
          sh_flags:  0x6,
        };
      }
    }
    return text;
  }

  function buildSymbolMap(e) {
    const m = new Map();
    for (const s of e.symbols) {
      if (!s.name || !s.name.length) continue;
      if (s.type !== 2 && s.type !== 0) continue;
      const addr = Number(s.st_value);
      if (addr === 0) continue;
      if (!m.has(addr)) m.set(addr, []);
      m.get(addr).push(s.name);
    }
    return m;
  }

  // ─── Virtual geometry ───────────────────────────
  function virtualGeometry(totalRows) {
    const naturalPx = Math.max(0, totalRows * ROW_HEIGHT);
    if (naturalPx <= MAX_PHYSICAL_PX) return { physicalPx: naturalPx, scale: 1 };
    return { physicalPx: MAX_PHYSICAL_PX, scale: naturalPx / MAX_PHYSICAL_PX };
  }

  function visibleRange(scrollTop) {
    if (totalInstrs === 0) return { start: 0, end: 0, topPx: 0 };
    const s = geom.scale;
    const virtualScrollTop = scrollTop * s;
    const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
    const rawStart = Math.floor(virtualScrollTop / ROW_HEIGHT) - OVERSCAN;
    const start = Math.max(0, rawStart);
    const end = Math.min(totalInstrs, start + visibleCount);
    let topPx;
    if (s === 1) {
      topPx = start * ROW_HEIGHT;
    } else {
      const remainder = virtualScrollTop - start * ROW_HEIGHT;
      topPx = scrollTop - remainder / s;
    }
    return { start, end, topPx };
  }

  // ─── DOM row pool ───────────────────────────────
  function ensurePool(n) {
    while (rowPool.length < n) {
      rowPool.push(document.createElement('div'));
    }
  }

  function symbolLabelAt(addr) {
    const list = symbols.get(addr);
    if (!list) return null;
    return list.join(', ');
  }

  function buildRowChildren(instr) {
    const sym = symbolLabelAt(instr.pc);

    const addr = document.createElement('span');
    addr.className = 'c addr';
    addr.textContent = hex(instr.pc);

    const bytesEl = document.createElement('span');
    bytesEl.className = 'c bytes';
    bytesEl.textContent = rawBytes4(instr.raw);

    const mnEl = document.createElement('span');
    mnEl.className = `c mn k-${instr.kind}`;
    mnEl.textContent = instr.mnemonic;

    const opsEl = document.createElement('span');
    opsEl.className = 'c ops';
    opsEl.textContent = instr.operands || '';

    const labelEl = document.createElement('span');
    labelEl.className = 'c label';
    if (sym) labelEl.textContent = '<' + sym + '>';

    return [addr, bytesEl, mnEl, opsEl, labelEl];
  }

  // ─── Render ─────────────────────────────────────
  function render() {
    if (!bytes || !sizerEl || totalInstrs === 0) {
      for (const r of rowPool) { if (r.parentNode) r.remove(); }
      if (sizerEl) sizerEl.style.height = '0px';
      return;
    }

    geom = virtualGeometry(totalInstrs);
    sizerEl.style.height = `${geom.physicalPx}px`;

    const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
    const range = visibleRange(scrollTop);
    const count = range.end - range.start;
    ensurePool(count);

    // Decode just the visible window.
    const startOff = textOffset + range.start * 4;
    const length = count * 4;
    const decoded = disassembleRange(bytes, startOff, length, baseAddr + range.start * 4);

    // Detach excess rows.
    for (let i = count; i < rowPool.length; i++) {
      if (rowPool[i].parentNode) rowPool[i].remove();
    }

    for (let i = 0; i < count; i++) {
      const r = rowPool[i];
      r.className = 'd-row';
      r.style.position = 'absolute';
      r.style.left = '0';
      r.style.right = '0';
      r.style.top = `${range.topPx + i * ROW_HEIGHT}px`;
      r.style.height = `${ROW_HEIGHT}px`;
      r.replaceChildren(...buildRowChildren(decoded[i]));
      if (r.parentNode !== sizerEl) sizerEl.appendChild(r);
    }
  }

  // ─── Scroll to address ──────────────────────────
  function scrollToAddress(addr) {
    if (totalInstrs === 0) return false;
    const idx = Math.floor((addr - baseAddr) / 4);
    if (idx < 0 || idx >= totalInstrs) return false;
    const virtualY = idx * ROW_HEIGHT;
    scrollEl.scrollTop = virtualY / (geom.scale || 1);
    return true;
  }

  // ─── GOTO form ──────────────────────────────────
  function gotoSubmit(e) {
    e.preventDefault();
    const raw = gotoVal.trim();
    if (!raw) return;
    const n = parseInt(raw.replace(/^0x/i, ''), 16);
    if (!Number.isFinite(n) || n < 0) return;
    scrollToAddress(n >>> 0);
  }

  // ─── Keyboard nav ───────────────────────────────
  function onKeydown(e) {
    if (!bytes || totalInstrs === 0) return;
    const page = Math.max(1, Math.floor(viewportHeight / ROW_HEIGHT) - 2);
    const stepRow = (rows) => {
      const virtualY = scrollEl.scrollTop * (geom.scale || 1);
      const newVirtualY = Math.max(0, virtualY + rows * ROW_HEIGHT);
      scrollEl.scrollTop = newVirtualY / (geom.scale || 1);
    };
    if (e.key === 'PageDown') { e.preventDefault(); stepRow(page); }
    else if (e.key === 'PageUp') { e.preventDefault(); stepRow(-page); }
    else if (e.key === 'Home') { e.preventDefault(); scrollEl.scrollTop = 0; }
    else if (e.key === 'End') { e.preventDefault(); scrollEl.scrollTop = geom.physicalPx; }
  }

  // ─── Parse file on bytes change ─────────────────
  function refreshFromFile() {
    elf = null; textSection = null; baseAddr = 0;
    textOffset = 0; textBytesLen = 0; totalInstrs = 0;
    symbols = new Map(); isRiscv = false;

    if (!bytes) {
      warnText = '';
      sectionText = '';
      for (const r of rowPool) { if (r.parentNode) r.remove(); }
      if (sizerEl) sizerEl.style.height = '0px';
      return;
    }

    if (format === 'elf') {
      try {
        elf = parseElf(bytes);
        textSection = findTextSection(elf);
        symbols = buildSymbolMap(elf);
        isRiscv = elf.header.e_machine === 243;
        if (textSection) {
          textOffset = Number(textSection.sh_offset);
          textBytesLen = Number(textSection.sh_size);
          baseAddr = Number(textSection.sh_addr);
          totalInstrs = Math.floor(textBytesLen / 4);
          sectionText = `${textSection.name} \u00B7 ${textBytesLen.toLocaleString()} bytes \u00B7 @ ${hex(baseAddr)}`;
        } else {
          sectionText = '(no .text or executable section)';
        }
      } catch (e) {
        warnText = `ELF parse failed: ${e.message}`;
      }
    } else {
      // Raw bytes fallback.
      textOffset = 0;
      textBytesLen = bytes.byteLength;
      baseAddr = 0;
      totalInstrs = Math.floor(textBytesLen / 4);
      sectionText = `(raw bytes) \u00B7 ${bytes.byteLength.toLocaleString()} bytes`;
    }

    if (elf && !isRiscv) {
      warnText = `This file is ${elf.header.e_machine === 62 ? 'x86_64' : 'machine ' + elf.header.e_machine}. Disassembly is RV32IMA only -- output below is the .text bytes decoded as if they were RISC-V (will look like noise on non-RISC-V binaries).`;
    } else {
      warnText = '';
    }

    if (scrollEl) scrollEl.scrollTop = 0;
    rowPool = [];
  }

  // ─── Lifecycle ──────────────────────────────────
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
  let lastBytes = null;
  $effect(() => {
    const b = bytes;
    const f = format;
    if (b === lastBytes) return;
    lastBytes = b;
    refreshFromFile();
    untrack(() => render());
  });
</script>

<section class="d-wrap">
  <header class="d-bar">
    <span class="d-title">DISASM</span>
    <span class="d-arch">RV32IMA</span>
    <span class="d-sect">{sectionText}</span>
    <form class="d-goto" onsubmit={gotoSubmit}>
      <label class="d-goto-l">GOTO</label>
      <input
        type="text"
        bind:value={gotoVal}
        placeholder="0x00010000"
        spellcheck="false"
        autocomplete="off"
      />
    </form>
  </header>

  {#if warnText}
    <p class="d-warn">{warnText}</p>
  {/if}

  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="d-scroll"
    bind:this={scrollEl}
    tabindex="0"
    onkeydown={onKeydown}
  >
    <div class="d-sizer" bind:this={sizerEl}></div>
  </div>
</section>

<style>
  .d-wrap {
    display: grid;
    grid-template-rows: auto auto 1fr;
    height: 100%;
    min-height: 0;
  }

  .d-bar {
    display: flex;
    align-items: baseline;
    gap: 18px;
    padding: 16px 0 12px;
    border-bottom: 1px solid var(--grey, var(--rule));
  }
  .d-title {
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .d-arch {
    font-size: 10px;
    letter-spacing: 0.14em;
    color: var(--mint-deep);
    padding: 2px 8px;
    border: 1px solid var(--mint-deep);
    border-radius: 3px;
  }
  .d-sect {
    font-size: 11px;
    color: var(--ink);
    margin-left: auto;
  }
  .d-goto {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .d-goto-l {
    font-size: 9px;
    letter-spacing: 0.14em;
    color: var(--mint-deep);
  }
  .d-goto input {
    font-family: var(--mono);
    font-size: 11px;
    padding: 5px 8px;
    background: var(--paper);
    border: 1px solid var(--grey, var(--rule));
    border-radius: 3px;
    width: 130px;
    color: var(--ink);
  }
  .d-goto input:focus { outline: none; border-color: var(--mint-deep); }

  .d-warn {
    font-size: 10px;
    color: var(--muted);
    font-style: italic;
    padding: 8px 0;
    letter-spacing: 0.04em;
  }

  .d-scroll {
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
    font-size: 11px;
    padding-top: 8px;
    font-family: var(--mono);
    position: relative;
  }
  .d-scroll:focus { outline: 2px solid var(--mint-deep); outline-offset: -2px; }

  .d-sizer { position: relative; width: 100%; }

  /* Imperatively-created rows need :global() for scoped styles. */
  :global(.d-row) {
    display: grid;
    grid-template-columns: 110px 130px 90px 1fr 200px;
    gap: 16px;
    height: 22px;
    line-height: 22px;
    padding: 0 6px;
    white-space: nowrap;
    align-items: center;
  }
  :global(.d-row:hover) {
    background: var(--mint-pale);
  }
  :global(.d-row .c) { overflow: hidden; text-overflow: ellipsis; }
  :global(.d-row .addr) { color: var(--muted); letter-spacing: 0.02em; }
  :global(.d-row .bytes) { color: var(--muted); letter-spacing: 0.04em; font-size: 10px; }
  :global(.d-row .mn) {
    font-weight: 500;
    color: var(--ink);
  }
  :global(.d-row .mn.k-branch),
  :global(.d-row .mn.k-jump) { color: var(--mint-deep); }
  :global(.d-row .mn.k-load),
  :global(.d-row .mn.k-store) { color: var(--accent-store); }
  :global(.d-row .mn.k-system) { color: var(--accent-system); }
  :global(.d-row .mn.k-unknown) { color: var(--rule); font-style: italic; }
  :global(.d-row .ops) { color: var(--ink); }
  :global(.d-row .label) { color: var(--mint-deep); font-size: 10px; text-align: right; }
</style>
