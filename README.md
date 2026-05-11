# Scry

> Scry takes a binary and shows you what it would do, without leaving your browser tab.

A browser-based systems inspection workbench. Drop a file, see it parsed,
disassembled, emulated, and decoded. All client-side. No backend, no upload,
no login.

**Live:** [goolz.org/scry](https://goolz.org/scry)
**Status:** v1 shipped (pure JS), v2 scaffolded (Rust → WASM).

---

## Two engines, one app

`https://goolz.org/scry` is a single shell. The top bar carries a mode picker:

- **V1 · PURE** — hand-rolled vanilla JavaScript, HTML, and CSS. No
  framework. No bundler. No npm dependency at runtime. Every primitive in
  this build was written from the relevant spec or hand-decoded from the
  reference manual.
- **V2 · RUST · WASM** — the same workbench reimplemented on a Rust core
  compiled to WebAssembly with `wasm-pack`, fronted by Svelte 5 + Vite.

The mode picker swaps the inner surface in place. Dark mode, file drag, and
state are unified at the shell level so switching engines feels like
flipping a switch on the same instrument, not jumping between two sites.

The two builds exist on purpose. V1 is the receipt that I can build the
primitives. V2 is the receipt that I can ship them the way a real product
would ship.

---

## V1 · the pure-JS build

This is the load-bearing claim of the project. **Every file under
`web/v1/` is hand-written in vanilla JavaScript, HTML, or CSS.** No build
step. No transpiler. No framework. No runtime dependency. If you delete
`node_modules` and unplug the network, V1 still works from `file://`.

Concretely, V1 contains:

| Module      | Job                                                          | Implementation |
|-------------|--------------------------------------------------------------|----------------|
| Empty       | Drop-zone with samples picker, format sniffer, dark mode     | ES modules + custom Store class |
| Inspect     | ELF parser - sections, segments, symbols, strings            | Hand-rolled DataView reader, bounds-checked, spec-faithful |
| Hex         | Virtualized hex view with click-to-select byte detail        | Plain JS, manual viewport math |
| Disasm      | RV32IMA disassembly with symbols, goto, syscall hints        | Hand-decoded from the RISC-V ISA manual |
| Emu         | RV32IMA interpreter with register file, MMIO, step/run/halt  | Pure JS instruction dispatcher |
| Trace       | SPI + I2C decoders running on the emulator's MMIO bus log    | Two state-machine decoders, click-for-detail panel |

State sharing across modules uses a 30-line publish/subscribe `Store`
(`web/v1/js/store.js`) that the whole app is built around. Routing is the
URL hash. The CSS is roughly 1,200 lines split across nine files, all
driven by CSS custom properties so the dark-mode swap is a single
attribute on `<html>`.

The build pipeline for V1 is `cp`. The deploy pipeline is `rsync`. The
only post-processing in `scripts/build.sh` is an `esbuild --minify` pass
that re-uses the binary shipped with Vite's dev deps. V1 would run
without that pass too.

This is the lane I care most about. If somebody opens the V1 source and
points at any line, I can tell them why it is the way it is.

---

## V2 · the Rust + WASM build

V2 lives under `web/v2/`. It uses:

- `scry-core` (Rust crate, `rust/scry-core/`) compiled with `wasm-pack` to
  ES-module-flavored WebAssembly. Exposes `parse_elf`, `detect_format`,
  and `hex_rows`. Backed by `goblin` for ELF parsing.
- Svelte 5 (the runes-mode rewrite) + Vite for the shell. Two panes today:
  Inspect and Hex, both reading directly from the wasm module.
- The same design tokens, same fonts, same dark palette as V1. V2 inherits
  the shell's theme via `postMessage` from the parent when embedded.

V2 is intentionally smaller. It is here to prove that the same idea
survives the contact with a real toolchain.

---

## Layout

```
rust/scry-core/        Rust → WASM crate (parse_elf, detect_format, hex_rows)
web/index.html         Unified shell at /scry/ — mode picker + theme + iframe
web/v1/                Pure JS workbench, served verbatim (minified at deploy)
web/v2/                Vite + Svelte 5 app, builds to web/v2/dist/
docs/                  Scope, design spec, AI-collaboration writeup
scripts/build.sh       wasm-pack -> Vite -> rsync -> esbuild minify (v1)
scripts/deploy.sh      Push web/dist/ into the goolz Pages repo
```

## Build

```
scripts/build.sh    # full toolchain: Rust + Vite + stage to web/dist/
scripts/deploy.sh   # rsync web/dist/ -> ../goolz/scry/, commit, push
```

Prerequisites for the full chain: a Rust toolchain with the
`wasm32-unknown-unknown` target, `wasm-pack`, and Node. V1 by itself needs
none of these.

## Aesthetic

Apothecary spine. Full JetBrains Mono, Swiss grid bones, mint stripe on top,
warm off-white in light mode and a slate-and-paper palette in dark mode. The
daylight cousin of PEEK.

Subtlety is load-bearing. No icons unless they earn it. No animations
unless they explain state. The chrome stays out of the way.

## Docs

- [Scope document](docs/scope.html) — public-facing project overview
- [Design spec](docs/superpowers/specs/2026-05-11-scry-design.md) — internal contract
- [AI-collaboration writeup](docs/ai-session-writeup.md) — class deliverable
  on how this was built with Claude Code
