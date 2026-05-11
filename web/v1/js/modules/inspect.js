import { fileStore } from '../stores/file.js';
import { detectFormat } from '../format/detect.js';
import {
  parseElf,
  E_TYPE, E_MACHINE, SH_TYPE, P_TYPE,
  sectionFlagsLabel, segmentFlagsLabel,
  ST_BIND, ST_TYPE,
  hex, num
} from '../elf/parse.js';
import { el, replaceChildren } from '../dom.js';

const TABS = ['sections', 'segments', 'symbols'];

function summaryRow(label, value) {
  return el('div', { class: 'sum-row' }, [
    el('span', { class: 'l', text: label }),
    el('span', { class: 'v', text: value })
  ]);
}

function tableHeader(cols) {
  return el('div', { class: 'i-row i-head' }, cols.map(c =>
    el('span', { class: `c c-${c.key}`, text: c.label })
  ));
}

function tableRow(cols, datum, idx) {
  return el('div', {
    class: 'i-row',
    dataset: { idx: String(idx) }
  }, cols.map(c => {
    const v = c.get(datum);
    const cellClass = `c c-${c.key}${c.mono ? ' mono' : ''}${c.muted ? ' muted' : ''}`;
    return el('span', { class: cellClass, text: v });
  }));
}

function renderSummary(elf) {
  const cls = elf.is64 ? '64-bit' : '32-bit';
  const data = elf.le ? 'little-endian' : 'big-endian';
  const type = E_TYPE[elf.header.e_type] ?? `0x${elf.header.e_type.toString(16)}`;
  const mach = E_MACHINE[elf.header.e_machine] ?? `0x${elf.header.e_machine.toString(16)}`;
  const entry = hex(elf.header.e_entry, elf.is64 ? 16 : 8);

  return el('div', { class: 'i-summary' }, [
    summaryRow('Class', `${cls} · ${data}`),
    summaryRow('Type', type),
    summaryRow('Machine', mach),
    summaryRow('Entry', entry),
    summaryRow('Sections', String(elf.sections.length)),
    summaryRow('Segments', String(elf.segments.length)),
    summaryRow('Symbols', String(elf.symbols.length))
  ]);
}

function renderSections(elf) {
  const cols = [
    { key: 'idx',    label: '#',       get: (_, i) => i, mono: true, muted: true },
    { key: 'name',   label: 'NAME',    get: s => s.name || '(unnamed)' },
    { key: 'type',   label: 'TYPE',    get: s => SH_TYPE[s.sh_type] ?? hex(s.sh_type, 4), muted: true },
    { key: 'addr',   label: 'ADDR',    get: s => hex(s.sh_addr, elf.is64 ? 16 : 8), mono: true },
    { key: 'offset', label: 'OFFSET',  get: s => hex(s.sh_offset, 8), mono: true, muted: true },
    { key: 'size',   label: 'SIZE',    get: s => num(s.sh_size), mono: true },
    { key: 'flags',  label: 'FLAGS',   get: s => sectionFlagsLabel(s.sh_flags) || '—', mono: true }
  ];
  const rows = elf.sections.map((s, i) => tableRow(
    cols.map(c => ({ ...c, get: c.key === 'idx' ? (() => String(i).padStart(2, '0')) : c.get })),
    s, i
  ));
  return el('div', { class: 'i-table sect' }, [
    tableHeader(cols),
    ...rows
  ]);
}

function renderSegments(elf) {
  const cols = [
    { key: 'idx',    label: '#',       get: (_, i) => i, mono: true, muted: true },
    { key: 'type',   label: 'TYPE',    get: p => P_TYPE[p.p_type] ?? hex(p.p_type, 8) },
    { key: 'addr',   label: 'VADDR',   get: p => hex(p.p_vaddr, elf.is64 ? 16 : 8), mono: true },
    { key: 'offset', label: 'OFFSET',  get: p => hex(p.p_offset, 8), mono: true, muted: true },
    { key: 'filesz', label: 'FILESZ',  get: p => num(p.p_filesz), mono: true },
    { key: 'memsz',  label: 'MEMSZ',   get: p => num(p.p_memsz), mono: true },
    { key: 'flags',  label: 'FLAGS',   get: p => segmentFlagsLabel(p.p_flags) || '—', mono: true }
  ];
  const rows = elf.segments.map((p, i) => tableRow(
    cols.map(c => ({ ...c, get: c.key === 'idx' ? (() => String(i).padStart(2, '0')) : c.get })),
    p, i
  ));
  return el('div', { class: 'i-table' }, [
    tableHeader(cols),
    ...rows
  ]);
}

function renderSymbols(elf) {
  // Only show defined symbols with a name. The default st_shndx === 0
  // entry is the SHN_UNDEF placeholder.
  const filtered = elf.symbols.filter(s => s.name && s.name.length > 0);
  const cols = [
    { key: 'idx',    label: '#',     get: (_, i) => i, mono: true, muted: true },
    { key: 'name',   label: 'NAME',  get: s => s.name },
    { key: 'bind',   label: 'BIND',  get: s => ST_BIND[s.bind] ?? String(s.bind), muted: true },
    { key: 'type',   label: 'TYPE',  get: s => ST_TYPE[s.type] ?? String(s.type), muted: true },
    { key: 'value',  label: 'VALUE', get: s => hex(s.st_value, elf.is64 ? 16 : 8), mono: true },
    { key: 'size',   label: 'SIZE',  get: s => num(s.st_size), mono: true }
  ];
  const rows = filtered.slice(0, 2000).map((s, i) => tableRow(
    cols.map(c => ({ ...c, get: c.key === 'idx' ? (() => String(i).padStart(4, '0')) : c.get })),
    s, i
  ));
  const truncated = filtered.length > 2000
    ? [el('div', { class: 'i-note', text: `(showing 2000 of ${filtered.length}; symbol table truncated for display)` })]
    : [];
  return el('div', { class: 'i-table' }, [
    tableHeader(cols),
    ...rows,
    ...truncated
  ]);
}

export function createInspect() {
  let activeSub = 'sections';
  let elf = null;
  let parseError = null;

  const subTabs = el('div', { class: 'i-subtabs' });
  const body = el('div', { class: 'i-body' });
  const summary = el('div', { class: 'i-summary-host' });
  const wrap = el('section', { class: 'i-wrap' }, [
    el('header', { class: 'i-bar' }, [
      el('span', { class: 'i-title', text: 'INSPECT' }),
      subTabs
    ]),
    summary,
    body
  ]);

  function buildSubTabs() {
    const buttons = TABS.map(id => {
      const btn = el('button', {
        class: id === activeSub ? 'on' : '',
        text: id.toUpperCase(),
        onclick: () => { activeSub = id; refresh(); }
      });
      return btn;
    });
    replaceChildren(subTabs, buttons);
  }

  function refresh() {
    const bytes = fileStore.get().bytes;
    if (!bytes) {
      replaceChildren(summary, []);
      replaceChildren(body, [el('p', { class: 'i-empty', text: 'No file loaded.' })]);
      return;
    }
    const kind = detectFormat(bytes);
    if (kind !== 'elf') {
      replaceChildren(summary, []);
      replaceChildren(body, [
        el('p', { class: 'i-empty', text: 'This file is not an ELF. Inspect currently supports ELF only.' })
      ]);
      return;
    }

    if (!elf || parseError) {
      try {
        elf = parseElf(bytes);
        parseError = null;
      } catch (e) {
        parseError = e;
        replaceChildren(summary, []);
        replaceChildren(body, [
          el('p', { class: 'i-empty', text: `Failed to parse ELF: ${e.message}` })
        ]);
        return;
      }
    }

    replaceChildren(summary, [renderSummary(elf)]);
    buildSubTabs();
    let panel;
    if (activeSub === 'sections') panel = renderSections(elf);
    else if (activeSub === 'segments') panel = renderSegments(elf);
    else panel = renderSymbols(elf);
    replaceChildren(body, [panel]);
  }

  fileStore.subscribe(() => {
    elf = null;
    parseError = null;
    activeSub = 'sections';
    refresh();
  });

  refresh();
  return wrap;
}
