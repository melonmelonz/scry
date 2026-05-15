import { fileStore } from '../stores/file.js';
import { formatLabel } from '../format/detect.js';
import { parseElf, E_MACHINE } from '../elf/parse.js';
import { parseWav } from '../format/wav.js';
import { entropyMean } from '../hex/entropy.js';
import { el, replaceChildren } from '../dom.js';
import { fmtBytes } from '../fmt.js';

function railRow(label, value) {
  return el('div', { class: 'row' }, [
    el('span', { class: 'l', text: label }),
    el('span', { class: 'v', text: value })
  ]);
}

// Build the one-line auto-summary that sits under the FILE/SIZE/FORMAT block.
// Adapts to what was actually detected — non-ELFs get the byte-count fallback.
function summaryLine(bytes, kind) {
  const ent = entropyMean(bytes);
  const entTxt = `avg entropy ${ent.toFixed(1)} bits`;
  if (kind === 'wav') {
    try {
      const w = parseWav(bytes);
      const dur = w.duration < 1
        ? `${(w.duration * 1000).toFixed(0)} ms`
        : `${w.duration.toFixed(2)} s`;
      return `${w.fmt.channels}ch ${w.fmt.sampleRate} Hz \u00B7 ${w.fmt.bitsPerSample}-bit \u00B7 ${dur} \u00B7 ${entTxt}`;
    } catch (_) {
      return `WAV (parse failed) \u00B7 ${entTxt}`;
    }
  }
  if (kind === 'gba') {
    // Pull a few header fields directly so we don't pay the cost of a
    // full ROM scan in the rail. 0xA0..0xAB = title, 0xAC..0xAF = code.
    let title = '';
    for (let i = 0; i < 12; i++) {
      const b = bytes[0xA0 + i];
      if (!b) break;
      if (b >= 0x20 && b <= 0x7E) title += String.fromCharCode(b);
    }
    let code = '';
    for (let i = 0; i < 4; i++) {
      const b = bytes[0xAC + i];
      if (b >= 0x20 && b <= 0x7E) code += String.fromCharCode(b);
    }
    return `GBA cart \u00B7 "${title.trim()}" \u00B7 code ${code} \u00B7 ${entTxt}`;
  }
  if (kind !== 'elf') {
    return `bytes only \u00B7 ${entTxt}`;
  }
  try {
    const elf = parseElf(bytes);
    const cls = elf.is64 ? '64-bit' : '32-bit';
    const mach = E_MACHINE[elf.header.e_machine] ?? `mach-${elf.header.e_machine}`;
    // Symbols list includes the SHN_UNDEF placeholder; filter to defined
    // names so the count matches what INSPECT actually shows.
    const symCount = elf.symbols.filter(s => s.name && s.name.length > 0).length;
    return `${cls} ${mach} \u00B7 ${elf.sections.length} sections \u00B7 ${symCount} symbols \u00B7 ${entTxt}`;
  } catch (_) {
    return `ELF (parse failed) \u00B7 ${entTxt}`;
  }
}

export function createFileRail() {
  const host = document.createElement('aside');
  host.className = 's-rail';

  function render(state) {
    if (state.loading) {
      replaceChildren(host, [
        railRow('Loading', state.status || 'reading\u2026')
      ]);
      return;
    }
    if (state.bytes) {
      const kind = state.kind;
      const summary = el('div', { class: 's-rail-summary', text: summaryLine(state.bytes, kind) });
      replaceChildren(host, [
        railRow('File', state.name),
        railRow('Size', fmtBytes(state.bytes.byteLength)),
        railRow('Format', formatLabel(kind)),
        summary
      ]);
    } else {
      const dot = el('span', { class: 'mint', text: '\u00B7' });
      const v = el('span', { class: 'v' }, [dot, ' drop or pick to begin']);
      const row = el('div', { class: 'row' }, [
        el('span', { class: 'l', text: 'No file loaded' }),
        v
      ]);
      replaceChildren(host, [row]);
    }
  }

  render.__dbg = 'filerail.render';
  fileStore.subscribe(render);
  return host;
}
