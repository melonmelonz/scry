import { fileStore } from '../stores/file.js';
import { detectFormat } from '../format/detect.js';
import { parseElf } from '../elf/parse.js';
import { loadFromElf } from '../emu/loader.js';
import { ABI } from '../emu/cpu.js';
import { decode } from '../disasm/rv32.js';
import { el, replaceChildren } from '../dom.js';
import { busLog } from '../stores/bus.js';

function hex(n, w = 8) {
  return '0x' + ((n >>> 0).toString(16).toUpperCase()).padStart(w, '0');
}

export function createEmu() {
  let elf = null;
  let cpu = null;
  let mem = null;
  let parseError = null;
  let runHandle = null;

  // ── UI scaffolding ────────────────────────────────────────────────────
  const titleEl = el('span', { class: 'e-title', text: 'EMU · RV32IMA' });

  const btnReset = el('button', { class: 'e-btn', text: 'RESET' });
  const btnStep  = el('button', { class: 'e-btn', text: 'STEP' });
  const btnRun   = el('button', { class: 'e-btn primary', text: 'RUN' });
  const btnHalt  = el('button', { class: 'e-btn', text: 'HALT' });
  const controls = el('div', { class: 'e-controls' }, [btnReset, btnStep, btnRun, btnHalt]);

  const bar = el('header', { class: 'e-bar' }, [titleEl, controls]);

  const regsPanel = el('div', { class: 'e-regs' });
  const stateLine = el('div', { class: 'e-state' });
  const nextInstr = el('div', { class: 'e-next' });
  const warn = el('p', { class: 'e-warn' });

  const left = el('aside', { class: 'e-left' }, [stateLine, nextInstr, regsPanel]);

  const memHost = el('div', { class: 'e-mem' });
  const main = el('div', { class: 'e-main' }, [memHost]);

  const body = el('div', { class: 'e-body' }, [left, main]);

  const wrap = el('section', { class: 'e-wrap' }, [bar, warn, body]);

  // ── Helpers ───────────────────────────────────────────────────────────
  function setRunning(on) {
    btnRun.textContent = on ? 'RUNNING…' : 'RUN';
    btnRun.classList.toggle('on', on);
  }

  function renderRegs() {
    if (!cpu) {
      replaceChildren(regsPanel, []);
      stateLine.textContent = '';
      nextInstr.textContent = '';
      return;
    }
    const rows = [];
    // Two columns of 16 registers each.
    for (let r = 0; r < 32; r++) {
      const cell = el('div', { class: 'r-cell' }, [
        el('span', { class: 'rn', text: 'x' + r.toString().padStart(2, '0') }),
        el('span', { class: 'ra', text: ABI[r] }),
        el('span', { class: 'rv', text: hex(cpu.x[r] >>> 0) })
      ]);
      rows.push(cell);
    }
    replaceChildren(regsPanel, rows);

    const pcText = `PC ${hex(cpu.pc)}  ·  CYC ${cpu.cycles.toLocaleString()}  ·  ${cpu.halted ? 'HALT' : 'READY'}${cpu.halted && cpu.haltReason ? ' — ' + cpu.haltReason : ''}`;
    stateLine.textContent = pcText;

    // Disassemble the upcoming instruction.
    try {
      const word = mem.readU32(cpu.pc);
      const d = decode(word, cpu.pc);
      nextInstr.textContent = `${hex(cpu.pc)}    ${d.mnemonic.padEnd(8)} ${d.operands}`;
    } catch (e) {
      nextInstr.textContent = `${hex(cpu.pc)}    (bad fetch)`;
    }
  }

  function renderMemPeek() {
    if (!mem) { replaceChildren(memHost, []); return; }
    // Show 256 bytes around PC, plus a separate panel for the MMIO window.
    const around = el('div', { class: 'e-mem-pane' }, [memPaneFor('AROUND PC', cpu.pc & ~0xF, 256)]);
    const stack = el('div', { class: 'e-mem-pane' }, [memPaneFor('STACK (SP)', cpu.x[2] & ~0xF, 128)]);
    const mmio  = el('div', { class: 'e-mem-pane' }, [memPaneFor('MMIO WINDOW', 0x10000000, 128)]);
    replaceChildren(memHost, [around, stack, mmio]);
  }

  function memPaneFor(label, baseAddr, len) {
    const lines = [];
    lines.push(el('div', { class: 'e-mem-label', text: `[ ${label} · ${hex(baseAddr)} ]` }));
    const rows = el('div', { class: 'e-mem-rows' });
    for (let off = 0; off < len; off += 16) {
      const row = el('div', { class: 'e-mem-row' });
      row.appendChild(el('span', { class: 'addr', text: hex(baseAddr + off) }));
      const hexes = [];
      const ascii = [];
      for (let i = 0; i < 16; i++) {
        const a = (baseAddr + off + i) >>> 0;
        if (a >= mem.size) { hexes.push('  '); ascii.push(' '); continue; }
        let v;
        try { v = mem.readU8(a); } catch { v = 0; }
        hexes.push(v.toString(16).padStart(2, '0').toUpperCase());
        ascii.push((v >= 0x20 && v <= 0x7E) ? String.fromCharCode(v) : '.');
      }
      row.appendChild(el('span', { class: 'bytes', text: hexes.join(' ') }));
      row.appendChild(el('span', { class: 'ascii', text: ascii.join('') }));
      rows.appendChild(row);
    }
    lines.push(rows);
    return el('div', {}, lines);
  }

  function busSink(event) {
    busLog.push({ ...event, cycle: cpu ? cpu.cycles : 0, pc: cpu ? cpu.pc : 0 });
  }

  function loadFile() {
    elf = null; cpu = null; mem = null; parseError = null;
    stopRun();
    const bytes = fileStore.get().bytes;
    if (!bytes) {
      warn.textContent = 'No file loaded.';
      renderRegs(); renderMemPeek();
      return;
    }
    if (detectFormat(bytes) !== 'elf') {
      warn.textContent = 'Emulator needs an ELF.';
      renderRegs(); renderMemPeek();
      return;
    }
    try {
      elf = parseElf(bytes);
    } catch (e) {
      parseError = e;
      warn.textContent = `ELF parse failed: ${e.message}`;
      renderRegs(); renderMemPeek();
      return;
    }
    if (elf.header.e_machine !== 243) {
      warn.textContent = `This file targets machine ${elf.header.e_machine} (not RV32). Emulator runs RV32IMA only — emulator is disabled.`;
      renderRegs(); renderMemPeek();
      return;
    }
    try {
      const { cpu: c, mem: m } = loadFromElf(elf, bytes, busSink);
      cpu = c; mem = m;
      busLog.clear();
      warn.textContent = '';
    } catch (e) {
      warn.textContent = `Loader failed: ${e.message}`;
      cpu = null; mem = null;
    }
    renderRegs(); renderMemPeek();
  }

  function reset() {
    stopRun();
    if (!cpu || !elf) return;
    const entry = Number(elf.header.e_entry) >>> 0;
    cpu.reset(entry, 0x00800000);
    busLog.clear();
    renderRegs(); renderMemPeek();
  }

  function stepOnce() {
    if (!cpu) return;
    cpu.step();
    renderRegs(); renderMemPeek();
  }

  function startRun() {
    if (!cpu || runHandle) return;
    setRunning(true);
    const tick = () => {
      if (!cpu || cpu.halted) { stopRun(); return; }
      // Run a budget per frame; keep the UI responsive.
      cpu.run(5000);
      renderRegs(); renderMemPeek();
      if (cpu.halted) { stopRun(); return; }
      runHandle = requestAnimationFrame(tick);
    };
    runHandle = requestAnimationFrame(tick);
  }

  function stopRun() {
    if (runHandle) cancelAnimationFrame(runHandle);
    runHandle = null;
    setRunning(false);
  }

  btnReset.addEventListener('click', reset);
  btnStep.addEventListener('click', stepOnce);
  btnRun.addEventListener('click', startRun);
  btnHalt.addEventListener('click', stopRun);

  fileStore.subscribe(loadFile);
  loadFile();
  return wrap;
}
