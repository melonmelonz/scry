# Scry — Design Spec

> **Scry takes a binary and shows you what it would do, without leaving your browser tab.**

**Date:** 2026-05-11
**Status:** v1 shipped (pure JS). v2 scaffolded (Rust → WASM, Svelte 5, Vite). Unified shell live.
**Repo:** `~/dev/scry` — `github.com/melonmelonz/scry`
**Deploy:** `~/dev/goolz/scry/` (artifacts synced from `web/dist/`)
**Live:** `goolz.org/scry`

---

## 0. Status & roadmap (2026-05-11 EOD)

> This section supersedes parts of §4, §8, §10, and §11 below. The original
> spec assumed a single Rust+Svelte build. Reality forked into two engines,
> on purpose, and they now live behind one shell.

### What shipped

- **Unified shell** at `goolz.org/scry`. Top bar carries the brand, a mode
  picker (V1·PURE / V2·RUST·WASM), and a theme toggle. The selected engine
  is loaded into an iframe; the shell owns dark mode and propagates it via
  `postMessage`. Mode persists in `localStorage` + URL hash (`#v1` / `#v2`).
  Direct routes `/scry/v1/` and `/scry/v2/` still work standalone.
- **V1 — pure-JS workbench (load-bearing).** Every file under `web/v1/` is
  hand-written vanilla JS / HTML / CSS. No framework, no bundler, no
  runtime dependency. Modules:
  - Empty (drop, samples picker, format sniff, dark mode)
  - Inspect (hand-rolled ELF parser with bounds-checked DataView reads)
  - Hex (virtualized scroll, click-to-select byte detail)
  - Disasm (hand-decoded RV32IMA listing, symbol resolution, goto, syscall hints)
  - Emu (RV32IMA interpreter with state badges, halt/fault reasons, MMIO)
  - Trace (SPI + I2C decoders over the emu's MMIO bus log, click-for-detail)
  - Shared store: 30-line pub/sub `Store` in `web/v1/js/store.js`
  - Routing: URL hash
  - Status bar with per-module hint propagation (`stores/hint.js`)
  - Cross-module navigation (`stores/nav.js` — inspect symbol → disasm at addr)
  - Dark mode via CSS custom properties + `[data-theme]` + `prefers-color-scheme`
- **V2 — Rust → WASM scaffold.** Cargo workspace + `rust/scry-core/`
  exposing `parse_elf` (goblin), `detect_format`, `hex_rows` via
  `wasm-bindgen` + `serde-wasm-bindgen`. Svelte 5 (runes) + Vite shell at
  `web/v2/` with Drop, Inspect (Summary/Sections/Segments/Symbols), and Hex
  panels reading directly from the wasm module.
- **Build pipeline.** `scripts/build.sh` chains Rust → `wasm-pack` → Vite
  → rsync, then minifies V1 in place using the `esbuild` binary bundled
  with Vite's dev deps. `scripts/deploy.sh` rsyncs to the goolz Pages repo
  and pushes (ASCII-only commit message per the known wrangler constraint).
- **Hardening.**
  - ELF parser bounds-checks every header field. Malformed input throws a
    clean `malformed ELF: …` instead of a raw DataView `RangeError`.
  - Section/segment/symbol counts capped (65_535 / 65_535 / 1_000_000).
  - Sample-manifest filenames whitelisted by regex (`/^[A-Za-z0-9._-]+\.elf$/`)
    and URL-encoded before fetch.
  - Drag-drop ingestion capped at 64 MiB.

### Direction shift vs. the original spec

- **Two engines, not one.** The spec assumed Svelte+Rust from day one. The
  pure-JS V1 came first because the receipt "I can build the primitives"
  is the load-bearing claim of this project; V2 was layered on top later
  as the receipt "I can also ship them properly".
- **x86_64 disassembly deferred indefinitely.** V1's disasm is RV32IMA
  only (hand-decoded). `iced-x86` is no longer in the V2 roadmap; if x86
  lands, it ships through a smaller hand-written decoder so the artifact
  stays portfolio-pointable.
- **Synthetic bus, not `.sal` files.** V1's Trace ingests the emulator's
  own MMIO log instead of Saleae `.sal` captures. `.sal` ingest is
  deferred (now a stretch goal in §0 → "later").
- **Aesthetic update.** Spec §3 said "out of scope: dark mode (v1)". Dark
  mode is now shipped across landing, v1, v2, and the scope doc, tokenized
  through CSS custom properties.

### Next (in priority order)

1. **V2: Disasm + Emu.** Port the hand-decoded RV32IMA tables from V1's
   `js/disasm/rv32.js` into a Rust module inside `scry-core` and expose
   `disasm_rv32(bytes, base, range)`. Then port the V1 interpreter to Rust
   for V2's Emu pane. The V1 implementations stay; V2 reuses the same
   semantics, written in Rust.
2. **V2: Trace.** Hook the V2 emulator's MMIO writes to a Rust-side bus
   event stream; render the same SPI/I2C panes V1 has, but reading from
   `emu_drain_bus_events()` instead of a JS store.
3. **PE + Mach-O sniffing.** `detect_format` already covers them. Add
   minimal headers-only inspect panes so V2 has something to show when a
   non-ELF lands. Full parsing deferred.
4. **`.sal` ingest.** `fflate` + a small decoder. Lives in V2 only; V1
   keeps its synthetic-only ingest.
5. **CSP tightening.** The current page CSP is permissive (`unsafe-inline`,
   `https:` in `connect-src`, `img-src`). Audit each one against actual
   need; remove anything we don't use.

### Later (acknowledged, not scheduled)

- Compressed (C) and floating-point (F/D) RV32 extensions.
- Saleae CSV / `.sr` (sigrok) ingest.
- UART, CAN, 1-Wire decoders.
- Kaitai-style schema language for user-defined hex overlays.
- Decompilation, CFG view, xref panel.

---

## 1. Summary

Scry is a browser-based systems inspection workbench. Drop a binary, parse it, disassemble it, emulate it, observe the bus traffic it generates. No backend, no upload, no login — everything runs client-side via a JS shell and a Rust→WASM engine.

It is a sibling of PEEK in tone (quiet, observational, eldritch-coded restraint) but presented in daylight palette. The thesis demo at the end pairs Scry with a PEEK-adjacent firmware artifact: emulate it, watch it talk on a simulated SPI bus, decode the bus traffic, all in the browser.

## 2. Goals and non-goals

**Goals:**

- Ship a complete demo loop in one week: drop ELF → inspect → disassemble → emulate → simulated bus traffic → decoded transactions.
- Demonstrate systems-engineering depth (ELF, disassembly, ISA emulation, protocol decoding) in a single coherent artifact.
- Daily-useful to others as a binary inspector and logic-capture viewer, even without the demo loop.
- Production-grade aesthetic — Apothecary spine (full monospace, mint stripe, numbered grid, bracketed labels).
- Plug-in module architecture: shell knows about a module registry, modules expose a uniform interface, future modules add cleanly.

**Non-goals (v1):**

- Decompilation, graph view of CFG, xref panel UI.
- Full multi-architecture coverage. v1 = ELF + x86_64 disasm + RV32IMA emu.
- MMU, virtual memory, full Linux syscall layer in the emulator.
- Mach-O / PE parsing. (Architected to add later; deferred.)
- Real Saleae capture support beyond `.sal`. CSV / `.sr` deferred.
- Protocol decoders beyond I²C and SPI. UART / CAN / 1-Wire deferred.
- Schema-language UI for struct overlays (Kaitai-style). v1 ships hand-written overlays for ELF headers only.
- Server-side anything. No hosted state, no telemetry, no login.

## 3. Aesthetic

**Locked direction:** Apothecary spine — full monospace, Swiss grid bones.

**Palette (locked):**

```
--bg:         #F2F1EC    page background, warm off-white
--paper:      #FAF8F2    surface (cards, panels)
--grey:       #DEDDD7    rules and borders
--rule:       #C7C5BF    secondary rules
--ink:        #1F2421    primary text
--muted:      #8A8E87    secondary text
--mint:       #A6C9B5    fills, tints
--mint-deep:  #5E957A    accents, semantic state
--mint-pale:  #E2EEE7    selection bg, hover tint
```

**Typography (locked):**

- Single typeface family: **JetBrains Mono** weights 300/400/500/600.
- Sizes anchored at: 9px (labels, tracked), 10–11px (chrome), 12–13px (body data), 14–17px (headers), 22px+ (display).
- Tracked uppercase for labels: `letter-spacing: 0.14em–0.18em`.

**Structural rules:**

- 3px mint top stripe on every page.
- All major sections separated by a 1px `--grey` rule.
- All major data rows numbered in a 36–44px gutter column.
- Bracketed labels for semantic state: `[READY]`, `[rv32imac]`, `[exec]`.
- Diamond glyph `◆` precedes the wordmark.
- Status dots: 6px circles, mint-deep filled, with 6px right margin.

**Out of scope:** dark mode (v1), animation beyond 200ms ease, motion design.

## 4. Architecture

```
┌────────────────────────────────────────────────────────────┐
│  JS Shell  (Svelte 5 + Vite + TypeScript)                  │
│  ────────                                                  │
│  • File intake (File API, drag-drop, file picker)          │
│  • Format detection (magic bytes)                          │
│  • Module routing (hash router, static-host friendly)      │
│  • View composition (panels, hex view, tables, canvas)     │
│  • Design system (CSS tokens from §3)                      │
│                                                            │
│         │  typed bindings (wasm-bindgen)                   │
│         ▼                                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Rust Core  (compiled to WASM)                       │  │
│  │  ──────────                                          │  │
│  │  • parse/   ELF (via goblin)                         │  │
│  │  • disasm/  x86_64 (via iced-x86)                    │  │
│  │  • emu/     RV32IMA interpreter (hand-written)       │  │
│  │  • bus/     synthetic bus-event emission for demo    │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

**Build outputs to** `web/dist/` with `base: '/scry/'`. Deploy step rsyncs `web/dist/*` into `~/dev/goolz/scry/`. Goolz repo commits + pushes, Cloudflare Pages auto-deploys.

**File layout:**

```
scry/
  rust-core/
    Cargo.toml
    src/
      lib.rs              # wasm-bindgen exports
      parse/
        mod.rs
        elf.rs            # goblin wrapper, typed for JS
      disasm/
        mod.rs
        x86_64.rs         # iced-x86 wrapper
      emu/
        mod.rs            # CPU state, run loop
        decode.rs         # RV32IMA instruction decode
        execute.rs        # instruction semantics
        memory.rs         # flat memory model
        elf_loader.rs     # uses parse::elf to load segments
        syscalls.rs       # ECALL handler (write, exit, +bus)
      bus/
        mod.rs            # SPI/I²C synthetic event types
  web/
    package.json
    vite.config.ts
    index.html
    src/
      main.ts
      App.svelte
      lib/
        wasm/             # generated bindings + glue
        design/
          tokens.css      # palette, type, spacing
          base.css        # reset, typography baseline
          components.css  # shared chrome (header, tabs, rows)
        format/
          detect.ts       # magic-byte format detection
        router.ts
      modules/
        inspect/          # B-Parse view (sections, symbols, strings)
        hex/              # D — virtualized hex + struct overlay
        disasm/           # B-Disasm view (linear listing)
        emu/              # C — emulator UI (regs, mem, step/run)
        trace/            # A — waveform + decoded transactions
        empty/            # landing / drop zone
      shell/
        Header.svelte
        TabBar.svelte
        StatusBar.svelte
  docs/
    superpowers/
      specs/2026-05-11-scry-design.md   ← this file
  scripts/
    build.sh              # builds rust → wasm → vite → dist
    deploy.sh             # rsync to ~/dev/goolz/scry/
  .gitignore
  README.md
```

## 5. The thesis demo (the spine)

The demo flow is the non-negotiable spine. Everything in v1 supports it.

```
[user]   drops peek-firmware.elf
[shell]  detects ELF magic, opens Inspect view
[B]      parses sections, symbols, segments
[user]   clicks "Disassemble main"
[B]      shows x86_64 disasm  (note: if firmware is RV32, disasm
                               supports RV32 via the emu decoder
                               sharing decode tables — see §6.4)
[user]   clicks "Emulate from entry"
[C]      loads ELF segments into emulator memory, sets PC = entry
[user]   clicks Run; emulator runs in worker
[firmware] executes a bit-banged SPI write to an OLED-like target
[emu]    detects MMIO writes to a designated SPI controller region,
         emits synthetic bus events via bus/mod.rs
[shell]  forwards bus events to the Trace module
[A]      renders the synthetic waveform on Canvas
[A]      decoder consumes events, shows decoded SPI transactions
[user]   sees "0xA1 0xC0 0x55..." with cycle timings, byte-by-byte
```

This is the artifact that goes on the grad-school applications. Everything else is depth.

## 6. Modules

### 6.1 Shell

**Responsibilities:**
- App frame (header, tabs, status bar, panels per §3).
- File intake: drag-drop on root, file picker via header action, paste-bytes via Cmd-V.
- Format detection: read first 16 bytes, dispatch by magic. ELF → Inspect. `.sal` (PK zip) → Trace. Unknown → Hex (raw bytes).
- Module routing: `#/inspect`, `#/disasm`, `#/emu`, `#/trace`, `#/hex`. Active module renders in the main panel.
- Global state: opened file (ArrayBuffer), parsed binary handle (WASM-side), emu handle, trace handle. Single Svelte store.
- Status bar: ready/busy state, file name, file size, current module, mint dot for online/local.

**Deferred:** multiple-file workspace, recent-files list, command palette.

### 6.2 Inspect (B-Parse)

**Responsibilities:**
- Show ELF header fields: class (32/64), endianness, machine, entry, type.
- Sections table: name, type, flags, addr, offset, size — sortable.
- Symbols table: name, addr, size, type, binding, section index.
- Segments (program headers) table.
- Strings extraction: scan `.rodata` for printable runs ≥ 4 chars.
- Click any address → switches to Hex module scrolled to offset.
- Click any symbol → switches to Disasm scrolled to symbol.

**Implementation:** Rust side uses `goblin::elf::Elf`. Exports typed structs across the WASM boundary. JS side renders tables with Svelte.

**Deferred:** Mach-O, PE, dynamic symbols pretty-printing, relocation tables, DWARF debug info.

### 6.3 Hex + Struct overlays (D)

**Pure JS.** No WASM dependency.

**Responsibilities:**
- Virtualized hex view: handle files up to 100 MB without scroll jank. Row height fixed (16 bytes per row), only visible rows rendered.
- Address column (mono), 16 hex pairs, ASCII gutter.
- Struct overlay layer: hand-written ELF-header overlay in v1. Schema is a JS data structure: `{ offset, size, name, type, color }[]`. Bytes in an overlay range get a tinted background; hover shows field name + decoded value.
- Cursor-following: arrow keys move byte cursor, displays current offset.
- "Jump to address" input (mono, hex).

**Deferred:** Schema-language UI, user-defined overlays, search, diff view.

### 6.4 Disasm (B-Disasm)

**Responsibilities:**
- Linear disassembly listing: addr | bytes | mnemonic | operands.
- For x86_64: `iced-x86` provides the decoder. We wrap and expose `disasm(bytes, base_addr, range) → Insn[]`.
- For RV32: shared decoder with the emulator (`emu::decode`). Single source of truth for RV32 instruction tables.
- Jump arrows in a left gutter (visible reach lines for short forward/back jumps).
- Symbol resolution: addresses that match a parsed symbol show the symbol name inline.
- Click on a jump target → scrolls to that address.

**Deferred:** Control-flow graph view, xref panel, basic-block highlighting, decompiler.

### 6.5 RV32 Emulator (C)

**Responsibilities:**
- RV32IMA interpreter. Hand-written; no external crate. Reason: the code is portfolio material; emulator should be ours to point at.
- Flat memory model (single contiguous Vec<u8>), no MMU.
- ELF loader: walk program headers, copy LOAD segments to memory, set PC to entry.
- ECALL syscall layer: `write` (fd 1, fd 2), `exit`, `scry_bus_emit` (custom — see §6.7).
- Run modes: step (one insn), run-until (PC == target), run-free (chunk in worker, yields to UI).
- UI: 32-register panel (live values, mono, hex), memory inspector (paged), current PC line highlighted in Disasm.
- Worker isolation: emulator run loop runs in a Web Worker; UI receives state updates via `postMessage`.

**Deferred:** Compressed instructions (C extension) — only IMA in v1. F/D extensions deferred. Atomics: A extension supports basic AMO; LR/SC pair sequential consistency only. CSRs minimal (cycle, time). Interrupts deferred.

### 6.6 Trace / Logic capture (A)

**Pure JS.**

**Responsibilities:**
- Two ingest paths:
  - **Real `.sal` files** (Saleae Logic 2 native): ZIP container with `meta.json` and binary `digital-*.bin` files. JS unzips with a small zip library (e.g., `fflate`), parses meta, reads digital channels.
  - **Synthetic events** from the emulator (§6.7). Same internal event format.
- Canvas waveform render: 1–4 channels, time axis, zoom + pan with mouse, gridlines.
- Protocol decoders (state machines):
  - **SPI**: CLK, MOSI, MISO, CS — emit transactions with byte stream and timing.
  - **I²C**: SDA, SCL — emit START/STOP/ADDR/DATA/ACK events.
- Decoded view: linear list under the waveform — `t=12.3µs  SPI  0xA1  0xC0  0x55`.

**Deferred:** UART, CAN, 1-Wire, custom decoders, search, marker export.

### 6.7 Bus bridge (the demo glue)

The connector that makes the thesis demo work.

**Responsibilities:**
- Define a designated MMIO region in the emulator's memory map: e.g., `0xF000_0000` for SPI controller, `0xF000_1000` for I²C. (Documented; firmware uses these addresses.)
- Emulator's memory-write path detects writes into the MMIO region and synthesizes bus events (channel transitions with timestamps in cycles).
- Events pushed to a shared channel (Rust → JS via `MessageChannel` from worker).
- Trace module's synthetic ingest reads from the same channel format as `.sal` files (uniform decoder pipeline).

The "user-friendly" framing: drop a PEEK-adjacent ELF, run it, see the bus the firmware would generate on real hardware — without real hardware.

## 7. Boundaries — the WASM API

Public functions exposed by `rust-core` via wasm-bindgen. Shape, not signature:

```
parse_elf(bytes: &[u8]) -> JsValue (ParsedElf)
disasm_x86_64(bytes: &[u8], base_addr: u64, range: u64) -> JsValue (Insn[])
disasm_rv32(bytes: &[u8], base_addr: u64, range: u64) -> JsValue (Insn[])

emu_create_from_elf(bytes: &[u8]) -> EmuHandle
emu_step(h: &EmuHandle, count: u32) -> StepResult
emu_run_until_halt(h: &EmuHandle, max_cycles: u64) -> RunResult
emu_read_regs(h: &EmuHandle) -> Regs
emu_read_memory(h: &EmuHandle, addr: u32, len: u32) -> Vec<u8>
emu_drain_bus_events(h: &EmuHandle) -> Vec<BusEvent>
```

Types crossing the boundary are flat structs serialized via `serde-wasm-bindgen`. No callbacks into JS from Rust except via the `postMessage` worker pattern in the emulator run loop.

## 8. Stack choices (locked)

- **Build:** Vite 6 + TypeScript 5.
- **UI framework:** Svelte 5 (runes). Smallest bundle, no virtual-DOM tax for hex viewer scrolling, ergonomic for static-hosting SPAs.
- **Hex viewer:** custom virtualized scroller (Svelte component). No external table lib.
- **Canvas:** native 2D context, no charting library.
- **Zip parsing (for .sal):** `fflate` (tiny, sync API, browser-only).
- **Rust toolchain:** `wasm-pack` + `wasm-bindgen` + `serde-wasm-bindgen`.
- **Rust crates:** `goblin` (ELF), `iced-x86` (x86_64 disasm), `serde`, `thiserror`. No emulator crate — hand-written.
- **Hosting:** Cloudflare Pages, the existing `goolz` project, subpath `/scry/`.

## 9. Testing strategy

- **Rust unit tests** in `rust-core/`:
  - `parse::elf`: round-trip a known ELF blob; assert section count, entry, symbol presence.
  - `emu::decode`: opcode-table coverage for each RV32IMA category.
  - `emu::execute`: instruction-level tests for arithmetic, branches, loads/stores, multiply/divide, atomics. Aim for ~80% instruction coverage with hand-rolled tests; reach for `riscv-tests` if time permits.
  - `bus`: synthetic SPI write sequence yields expected event stream.
- **JS shell:** no automated tests in v1. Visual + manual verification.
- **Integration:** the thesis demo itself is the system test. If `peek-firmware.elf` → decoded SPI works, v1 is done.

## 10. Day-by-day shape

Slack lives in Day 7. If a day slips, cut from the deferred-promotion list (§6.x), not the spine.

```
Day 1   Tooling setup (Vite + Svelte + Rust toolchain), shell, design system, file intake, routing
Day 2   D (Hex + Struct overlays), virtualized scroll, ELF header overlay
Day 3   B-Parse: Rust crate, wasm-bindgen wired, goblin integration, Inspect view
Day 4   B-Disasm: iced-x86 wrapper, linear listing, symbol resolution, jump arrows
Day 5   C: RV32IMA interpreter, register/memory panels, ELF loader, ECALL
Day 6   A: .sal parser, I²C + SPI decoders, Canvas waveform; wire emu bus → Trace
Day 7   Polish, demo prep, deploy to goolz.org/scry, README, recorded walkthrough
```

## 11. Deployment

- Source repo: `~/dev/scry` → `github.com/melonmelonz/scry` (new).
- `scripts/build.sh`:
  1. `cd rust-core && wasm-pack build --target web --out-dir ../web/src/lib/wasm`
  2. `cd web && npm run build` → `web/dist/`
- `scripts/deploy.sh`:
  1. `rsync -a --delete web/dist/ ~/dev/goolz/scry/`
  2. In goolz: `git add scry/`, commit (ASCII-only message per known CF Pages constraint), `git push`.
  3. Cloudflare Pages auto-deploys goolz.

Vite `base: '/scry/'` so all asset URLs work under the subpath.

## 12. Risks

- **wasm-bindgen first-touch:** half a day of integration friction is normal. Day 3 budget reflects this.
- **`iced-x86` bundle size** is large (~1.5 MB). Plan: ship as a separate WASM chunk, lazy-load on first disasm. Acceptable cost since disasm is opt-in.
- **Virtualized hex performance:** correctness is straightforward; smooth-scroll polish can swallow time. Acceptable v1 floor: handles 10 MB at 60 fps; 100 MB without crash.
- **`.sal` format archaeology:** Saleae publishes the format. Known shape: PK zip with `meta.json` (channels, sample rate, durations) + per-channel binary files. fflate handles the unzip. No real risk; 2–3 hours.
- **RV32 syscall ergonomics:** ECALL convention is fine for `write`/`exit`. The `scry_bus_emit` syscall is our own invention; firmware in the demo will use it. Document the calling convention in `docs/`.
- **Demo firmware availability:** the spine needs *a* PEEK-adjacent ELF to run. Plan B if no firmware ready: write a 30-line C program that bit-bangs `0xA1 0xC0 0x55` over the MMIO region; cross-compile with `riscv32-unknown-elf-gcc`. Ships either way.

## 13. Open questions

None blocking. Implementation plan addresses sequencing.

---

## Appendix A — Aesthetic blend rationale

Aesthetic locked at the start of brainstorming: **Apothecary spine, Datum bones.** All chrome and data in JetBrains Mono; numbered grid; mint stripe at top; bracketed semantic state. Reads as a precision instrument; carries thematic continuity with PEEK.

## Appendix B — Module dependency graph

```
shell ──┬─→ hex (D)
        │     ▲
        ├─→ inspect (B-Parse) ────┐
        │     │                   │
        ├─→ disasm (B-Disasm) ←── shares decode tables ─→
        │     │                                          │
        ├─→ emu (C) ──────────────────────────────────── ┘
        │     │
        │     └─→ bus events ──→ trace (A)
        │                          ▲
        └─→ trace (A) ←── .sal ────┘
```

Inspect and Hex have no inter-module deps; can be built independently.
Disasm depends on Inspect (for symbol resolution) and the shared RV32 decode tables (also used by Emu).
Emu depends on Inspect (ELF loader reuses parser).
Trace ingests either .sal files (independent) or bus events from Emu (shared event format).
