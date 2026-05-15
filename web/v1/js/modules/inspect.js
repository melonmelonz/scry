// INSPECT pane — DOM-mirror of v2's Inspect.svelte (lib/Inspect.svelte) so the
// parent shell's V1/V2 toggle shows the same surface from both engines. All
// class names mirror v2's exactly (.wrap / .tabs / .tab / .panel / .kv /
// .strings-bar / etc.) and css/inspect.css is a verbatim port of v2's <style>.
//
// v2 receives `{ report, strings, onJumpToOffset }` as props from App.svelte;
// v1 still builds the ELF report itself by calling parseElf(bytes) below. The
// onJumpToOffset prop is replaced by an inline router.go('hex') + gotoIn call.
//
// v1 has no extractStrings equivalent (the v2 version lives in scry-core WASM
// and there's no JS port in web/v1/js/format/), so the STRINGS tab is omitted
// entirely rather than rendered empty.

import { fileStore } from '../stores/file.js';
import {
  parseElf,
  E_TYPE, E_MACHINE, SH_TYPE, P_TYPE,
  sectionFlagsLabel, segmentFlagsLabel,
  ST_BIND, ST_TYPE,
  hex, num
} from '../elf/parse.js';
import { el, replaceChildren } from '../dom.js';
import { gotoIn } from '../stores/nav.js';
import { router } from '../stores/router.js';

// Max bar width for the sections-size mini-histogram (px). Matches v2.
const BAR_MAX = 80;

// Tabs from v2. The 'strings' tab is omitted in v1 (see header comment).
const TABS = [
  ['summary',  'SUMMARY'],
  ['sections', 'SECTIONS'],
  ['segments', 'SEGMENTS'],
  ['symbols',  'SYMBOLS']
];

// Reshape v1's raw ELF parse into the same field names v2's <Inspect> expects
// from its `report` prop. Keeping the mapping centralized here means the
// render functions can read like the Svelte template (`s.name`, `s.addr`,
// `s.kind`, …) without sprinkling format helpers across the DOM-building code.
function buildReport(elf) {
  const addrW = elf.is64 ? 16 : 8;
  const sections = elf.sections.map((s, i) => ({
    idx: i,
    name: s.name || '',
    kind: SH_TYPE[s.sh_type] ?? hex(s.sh_type, 4),
    addr: hex(s.sh_addr, addrW),
    offset: hex(s.sh_offset, 8),
    size: num(s.sh_size),
    flags: sectionFlagsLabel(s.sh_flags) || '—',
    // Hold onto the raw numbers so the click handler doesn't have to re-parse
    // the formatted hex strings on every jump.
    _offsetRaw: Number(s.sh_offset) >>> 0,
    _sizeRaw: Number(s.sh_size) || 0,
    _type: s.sh_type
  }));
  const segments = elf.segments.map((p, i) => ({
    idx: i,
    kind: P_TYPE[p.p_type] ?? hex(p.p_type, 8),
    vaddr: hex(p.p_vaddr, addrW),
    offset: hex(p.p_offset, 8),
    filesz: num(p.p_filesz),
    memsz: num(p.p_memsz),
    flags: segmentFlagsLabel(p.p_flags) || '—',
    _offsetRaw: Number(p.p_offset) >>> 0,
    _fileszRaw: Number(p.p_filesz) || 0
  }));
  const symbols = elf.symbols
    .filter(s => s.name && s.name.length > 0)
    .slice(0, 2000)
    .map(s => ({
      name: s.name,
      bind: ST_BIND[s.bind] ?? String(s.bind),
      kind: ST_TYPE[s.type] ?? String(s.type),
      value: hex(s.st_value, addrW),
      size: num(s.st_size),
      _valueRaw: Number(s.st_value) >>> 0,
      _type: s.type
    }));
  const summary = {
    class: elf.is64 ? 'ELF64' : 'ELF32',
    data: elf.le ? '2LSB' : '2MSB',
    osabi: 'SYSV',
    kind: E_TYPE[elf.header.e_type] ?? hex(elf.header.e_type, 4),
    machine: E_MACHINE[elf.header.e_machine] ?? hex(elf.header.e_machine, 4),
    entry: hex(elf.header.e_entry, addrW),
    n_sections: elf.sections.length,
    n_segments: elf.segments.length,
    n_symbols: elf.symbols.length
  };
  return { summary, sections, segments, symbols };
}

// Jump to an offset in the HEX pane. Keeps v1's existing cross-pane behavior
// (router.go + gotoIn) — v2's onJumpToOffset is wired by its parent and there's
// no equivalent shape at the v1 module boundary.
function jumpToOffset(offset, len) {
  router.go('hex');
  gotoIn('hex', offset >>> 0, typeof len === 'number' && len > 0 ? len : 1);
}

function jumpToAddr(addr) {
  router.go('disasm');
  gotoIn('disasm', addr >>> 0);
}

function renderSummary(report) {
  const dl = el('dl', { class: 'kv' }, [
    el('dt', { text: 'CLASS' }),    el('dd', { text: report.summary.class }),
    el('dt', { text: 'DATA' }),     el('dd', { text: report.summary.data }),
    el('dt', { text: 'OS/ABI' }),   el('dd', { text: report.summary.osabi }),
    el('dt', { text: 'TYPE' }),     el('dd', { text: report.summary.kind }),
    el('dt', { text: 'MACHINE' }),  el('dd', { text: report.summary.machine }),
    el('dt', { text: 'ENTRY' }),    el('dd', { class: 'addr', text: report.summary.entry }),
    el('dt', { text: 'SECTIONS' }), el('dd', { text: String(report.summary.n_sections) }),
    el('dt', { text: 'SEGMENTS' }), el('dd', { text: String(report.summary.n_segments) }),
    el('dt', { text: 'SYMBOLS' }),  el('dd', { text: String(report.summary.n_symbols) })
  ]);
  return dl;
}

function renderSections(report) {
  const maxSize = Math.max(1, ...report.sections.map(s => Number(s._sizeRaw) || 0));
  const headRow = el('tr', {}, [
    el('th', { text: '#' }),
    el('th', { text: 'NAME' }),
    el('th', { text: 'KIND' }),
    el('th', { text: 'ADDR' }),
    el('th', { text: 'OFF' }),
    el('th', { text: 'SIZE' }),
    el('th', { text: 'FLAGS' }),
    el('th', { class: 'bar-h', text: '─' })
  ]);
  const tbody = el('tbody', {}, report.sections.map(s => {
    const fillWidth = Math.max(1, (Number(s._sizeRaw) / maxSize) * BAR_MAX);
    const fill = el('span', { class: 'bar-fill' });
    fill.style.width = `${fillWidth}px`;
    // v1 keeps the existing "skip NULL + NOBITS" guard from the previous
    // implementation; v2 always emits a click. The hover affordance still
    // matches v2 because we mark the row clickable either way.
    const jumpable = s._sizeRaw > 0 && s._type !== 0 && s._type !== 8;
    const row = el('tr', {
      class: 'clickable',
      title: `Jump to offset ${s.offset} in HEX`
    }, [
      el('td', { text: String(s.idx) }),
      el('td', { class: 'name', text: s.name || '—' }),
      el('td', { text: s.kind }),
      el('td', { class: 'addr', text: s.addr }),
      el('td', { class: 'addr', text: s.offset }),
      el('td', { class: 'num', text: s.size }),
      el('td', { text: s.flags }),
      el('td', { class: 'bar' }, [fill])
    ]);
    if (jumpable) {
      row.addEventListener('click', () => jumpToOffset(s._offsetRaw, s._sizeRaw));
    }
    return row;
  }));
  return el('table', {}, [el('thead', {}, [headRow]), tbody]);
}

function renderSegments(report) {
  const headRow = el('tr', {}, [
    el('th', { text: '#' }),
    el('th', { text: 'KIND' }),
    el('th', { text: 'VADDR' }),
    el('th', { text: 'OFF' }),
    el('th', { text: 'FILESZ' }),
    el('th', { text: 'MEMSZ' }),
    el('th', { text: 'FLAGS' })
  ]);
  const tbody = el('tbody', {}, report.segments.map(s => {
    const row = el('tr', {
      class: 'clickable',
      title: `Jump to offset ${s.offset} in HEX`
    }, [
      el('td', { text: String(s.idx) }),
      el('td', { text: s.kind }),
      el('td', { class: 'addr', text: s.vaddr }),
      el('td', { class: 'addr', text: s.offset }),
      el('td', { class: 'num', text: s.filesz }),
      el('td', { class: 'num', text: s.memsz }),
      el('td', { text: s.flags })
    ]);
    row.addEventListener('click', () => jumpToOffset(s._offsetRaw, s._fileszRaw));
    return row;
  }));
  return el('table', {}, [el('thead', {}, [headRow]), tbody]);
}

function renderSymbols(report) {
  const headRow = el('tr', {}, [
    el('th', { text: 'NAME' }),
    el('th', { text: 'BIND' }),
    el('th', { text: 'KIND' }),
    el('th', { text: 'VALUE' }),
    el('th', { text: 'SIZE' })
  ]);
  const tbody = el('tbody', {}, report.symbols.map(s => {
    // v1 keeps its FUNC/NOTYPE-with-addr jump-to-disasm gesture. v2's symbol
    // rows aren't clickable at all, so we soften by only adding the click
    // when there's a meaningful address — hover still highlights, matching v2.
    const jumpable = s._valueRaw !== 0 && (s._type === 2 || s._type === 0);
    const row = el('tr', jumpable ? {
      class: 'clickable',
      title: `Jump to ${s.value} in DISASM`
    } : {}, [
      el('td', { class: 'name', text: s.name }),
      el('td', { text: s.bind }),
      el('td', { text: s.kind }),
      el('td', { class: 'addr', text: s.value }),
      el('td', { class: 'num', text: s.size })
    ]);
    if (jumpable) row.addEventListener('click', () => jumpToAddr(s._valueRaw));
    return row;
  }));
  return el('table', {}, [el('thead', {}, [headRow]), tbody]);
}

export function createInspect() {
  let tab = 'summary';
  let report = null;
  let parseError = null;

  const tabsHost = el('div', { class: 'tabs' });
  const panel = el('div', { class: 'panel' });
  const wrap = el('div', { class: 'wrap' }, [tabsHost, panel]);

  function buildTabs() {
    const buttons = TABS.map(([key, label]) => {
      const children = [document.createTextNode(label + ' ')];
      let count = null;
      if (report) {
        if (key === 'sections') count = report.sections.length;
        else if (key === 'segments') count = report.segments.length;
        else if (key === 'symbols') count = report.summary.n_symbols;
      }
      if (count != null) {
        children.push(el('span', { class: 'ct', text: String(count) }));
      }
      const btn = el('button', {
        class: `tab${tab === key ? ' active' : ''}`,
        onclick: () => { tab = key; refresh(); }
      }, children);
      return btn;
    });
    replaceChildren(tabsHost, buttons);
  }

  function renderPanel() {
    if (!report) {
      replaceChildren(panel, []);
      return;
    }
    let body;
    if (tab === 'summary')       body = renderSummary(report);
    else if (tab === 'sections') body = renderSections(report);
    else if (tab === 'segments') body = renderSegments(report);
    else if (tab === 'symbols')  body = renderSymbols(report);
    replaceChildren(panel, body ? [body] : []);
  }

  function showEmpty(message) {
    report = null;
    replaceChildren(tabsHost, []);
    // The empty-state intentionally lives inside .panel so the surrounding
    // border + paper background still render — v2 has the same behavior when
    // its report prop is falsy upstream.
    replaceChildren(panel, [el('p', { class: 'i-empty', text: message })]);
  }

  function refresh() {
    const state = fileStore.get();
    if (!state.bytes) { showEmpty('No file loaded.'); return; }
    if (state.kind !== 'elf') {
      showEmpty('This file is not an ELF. Inspect currently supports ELF only.');
      return;
    }
    if (!report || parseError) {
      try {
        report = buildReport(parseElf(state.bytes));
        parseError = null;
      } catch (e) {
        parseError = e;
        showEmpty(`Failed to parse ELF: ${e.message}`);
        return;
      }
    }
    buildTabs();
    renderPanel();
  }

  const sub = (state) => {
    report = null;
    parseError = null;
    tab = 'summary';
    refresh();
  };
  sub.__dbg = 'inspect.fileSub';
  fileStore.subscribe(sub);

  refresh();
  return wrap;
}
