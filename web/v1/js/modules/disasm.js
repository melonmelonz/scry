import { fileStore } from '../stores/file.js';
import { parseElf } from '../elf/parse.js';
import { disassembleRange } from '../disasm/rv32.js';
import { visibleRange, virtualGeometry, virtualToPhysical } from '../hex/virtualize.js';
import { el, replaceChildren } from '../dom.js';
import { navStore } from '../stores/nav.js';
import { setHint, clearHint } from '../stores/hint.js';
import { router } from '../stores/router.js';

const ROW_HEIGHT = 22;
const OVERSCAN = 6;

function hex(n, w = 8) {
  return '0x' + ((n >>> 0).toString(16).toUpperCase()).padStart(w, '0');
}

function rawBytes4(word) {
  const b = [(word >>> 0) & 0xFF, (word >>> 8) & 0xFF, (word >>> 16) & 0xFF, (word >>> 24) & 0xFF];
  return b.map(v => v.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

function findTextSection(elf) {
  // Prefer ".text"; otherwise the first executable PROGBITS section.
  let text = elf.sections.find(s => s.name === '.text');
  if (!text) {
    text = elf.sections.find(s =>
      s.sh_type === 1 && (Number(s.sh_flags) & 0x4) // SHF_EXECINSTR
    );
  }
  return text;
}

function buildSymbolMap(elf) {
  // address -> array of names. Stick to FUNC and NOTYPE symbols.
  const m = new Map();
  for (const s of elf.symbols) {
    if (!s.name || !s.name.length) continue;
    if (s.type !== 2 && s.type !== 0) continue;
    const addr = Number(s.st_value);
    if (addr === 0) continue;
    if (!m.has(addr)) m.set(addr, []);
    m.get(addr).push(s.name);
  }
  return m;
}

export function createDisasm() {
  let elf = null;
  let textSection = null;
  let baseAddr = 0;
  let textOffset = 0;
  let textBytesLen = 0;
  let totalInstrs = 0;
  let symbols = new Map();
  let isRiscv = false;

  let scrollTop = 0;
  let viewportHeight = 400;

  const titleEl = el('span', { class: 'd-title', text: 'DISASM' });
  const warn = el('p', { class: 'd-warn' });
  const archEl = el('span', { class: 'd-arch', text: 'RV32IMA' });
  const sectionLabel = el('span', { class: 'd-sect' });
  const gotoInput = el('input', { type: 'text', placeholder: '0x00010000', spellcheck: 'false', autocomplete: 'off' });
  const gotoForm = el('form', { class: 'd-goto' }, [
    el('label', { class: 'd-goto-l', text: 'GOTO' }),
    gotoInput
  ]);
  const bar = el('header', { class: 'd-bar' }, [titleEl, archEl, sectionLabel, gotoForm]);

  const scroll = el('div', { class: 'd-scroll' });
  const sizer = document.createElement('div');
  sizer.className = 'd-sizer';
  sizer.style.position = 'relative';
  sizer.style.width = '100%';
  scroll.appendChild(sizer);

  const wrap = el('section', { class: 'd-wrap' }, [bar, warn, scroll]);

  const rowPool = [];
  let geom = { physicalPx: 0, scale: 1 };

  function refreshFromFile() {
    const bytes = fileStore.get().bytes;
    elf = null; textSection = null; baseAddr = 0;
    textOffset = 0; textBytesLen = 0; totalInstrs = 0;
    symbols = new Map(); isRiscv = false;

    if (!bytes) {
      replaceChildren(warn, []);
      for (const r of rowPool) { if (r.parentNode) r.remove(); }
      sizer.style.height = '0px';
      sectionLabel.textContent = '';
      return;
    }

    if (fileStore.get().kind === 'elf') {
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
          sectionLabel.textContent = `${textSection.name} · ${textBytesLen.toLocaleString()} bytes · @ ${hex(baseAddr)}`;
        } else {
          sectionLabel.textContent = '(no .text or executable section)';
        }
      } catch (e) {
        warn.textContent = `ELF parse failed: ${e.message}`;
      }
    } else {
      // Raw bytes — disassemble whole file from offset 0 with base 0.
      textOffset = 0;
      textBytesLen = bytes.byteLength;
      baseAddr = 0;
      totalInstrs = Math.floor(textBytesLen / 4);
      sectionLabel.textContent = `(raw bytes) · ${bytes.byteLength.toLocaleString()} bytes`;
    }

    if (elf && !isRiscv) {
      warn.textContent = `This file is ${elf.header.e_machine === 62 ? 'x86_64' : 'machine ' + elf.header.e_machine}. Disassembly is RV32IMA only — output below is the .text bytes decoded as if they were RISC-V (will look like noise on non-RISC-V binaries).`;
    } else {
      warn.textContent = '';
    }

    scroll.scrollTop = 0;
    scrollTop = 0;
    render();
  }

  function ensureRowPool(n) {
    while (rowPool.length < n) {
      rowPool.push(document.createElement('div'));
    }
  }

  function symbolLabelAt(addr) {
    const list = symbols.get(addr);
    if (!list) return null;
    return list.join(', ');
  }

  function buildRow(instr) {
    const sym = symbolLabelAt(instr.pc);
    const addr = el('span', { class: 'c addr', text: hex(instr.pc) });
    const bytesEl = el('span', { class: 'c bytes', text: rawBytes4(instr.raw) });
    const mnEl = el('span', { class: `c mn k-${instr.kind}`, text: instr.mnemonic });
    const opsEl = el('span', { class: 'c ops', text: instr.operands || '' });
    const labelEl = sym
      ? el('span', { class: 'c label', text: '<' + sym + '>' })
      : el('span', { class: 'c label' });
    return [addr, bytesEl, mnEl, opsEl, labelEl];
  }

  function render() {
    const bytes = fileStore.get().bytes;
    if (!bytes || totalInstrs === 0) {
      for (const r of rowPool) { if (r.parentNode) r.remove(); }
      sizer.style.height = '0px';
      return;
    }

    geom = virtualGeometry(totalInstrs, ROW_HEIGHT);
    sizer.style.height = `${geom.physicalPx}px`;

    const range = visibleRange({
      scrollTop, viewportHeight,
      rowHeight: ROW_HEIGHT, totalRows: totalInstrs, overscan: OVERSCAN,
      scale: geom.scale
    });

    const count = range.end - range.start;
    ensureRowPool(count);

    // Decode just the visible window for speed.
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
      replaceChildren(r, buildRow(decoded[i]));
      if (r.parentNode !== sizer) sizer.appendChild(r);
    }
  }

  function scrollToAddress(addr) {
    if (totalInstrs === 0) return false;
    const idx = Math.floor((addr - baseAddr) / 4);
    if (idx < 0 || idx >= totalInstrs) {
      setHint('disasm', `address ${hex(addr)} outside ${hex(baseAddr)} \u2026 ${hex(baseAddr + totalInstrs * 4)}`);
      return false;
    }
    scroll.scrollTop = virtualToPhysical(idx * ROW_HEIGHT, geom.scale);
    setHint('disasm', `at ${hex(addr)} \u00B7 instr ${idx.toLocaleString()} of ${totalInstrs.toLocaleString()}`);
    return true;
  }

  // rAF-coalesce burst scroll events; same rationale as hex.js — without
  // it the virtualizer rebuilds the row window on every event during a fling.
  let scrollRaf = 0;
  scroll.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      scrollTop = scroll.scrollTop;
      render();
    });
  }, { passive: true });

  gotoForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = gotoInput.value.trim();
    if (!raw) return;
    const n = parseInt(raw.replace(/^0x/i, ''), 16);
    if (!Number.isFinite(n) || n < 0) return;
    scrollToAddress(n >>> 0);
  });

  const ro = new ResizeObserver(() => {
    viewportHeight = scroll.clientHeight;
    render();
  });
  ro.observe(scroll);

  // Cross-module nav: if someone (inspect) asks us to jump to an address,
  // honor it once we're the active route.
  navStore.subscribe((req) => {
    if (!req || req.route !== 'disasm') return;
    // Try now; if disasm isn't current, it'll fire again when the router
    // switches and we're mounted. (refreshFromFile will publish nav-related
    // hint on its own.)
    scrollToAddress(req.address);
  });

  router.subscribe((route) => {
    if (route !== 'disasm') clearHint('disasm');
  });

  fileStore.subscribe(refreshFromFile);
  refreshFromFile();
  return wrap;
}
