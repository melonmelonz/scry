# Scry

> Scry takes a binary and shows you what it would do, without leaving your browser tab.

A browser-based systems inspection workbench. Drop a file, see it parsed,
disassembled, emulated, and decoded — all client-side, with a JS shell and a
Rust→WASM engine. No backend, no upload, no login.

**Status:** Spec'd. Building.

**Live:** [goolz.org/scry](https://goolz.org/scry)

## What it does (v1)

| Module      | Job                                              | Stack    |
|-------------|--------------------------------------------------|----------|
| Inspect     | Parse ELF — sections, symbols, segments, strings | Rust→WASM (`goblin`) |
| Hex         | Virtualized hex view with typed struct overlays  | Pure JS  |
| Disasm      | x86_64 + RV32 disassembly with symbols + jumps   | Rust→WASM (`iced-x86`) |
| Emulate     | RV32IMA interpreter — registers, memory, step    | Rust→WASM (hand-written) |
| Trace       | `.sal` capture + SPI/I²C decoders, waveform      | Pure JS  |

The thesis demo: drop a RISC-V firmware ELF, emulate it bit-banging an
MMIO-mapped SPI controller, watch the simulated bus traffic flow into the
Trace view as decoded transactions.

## Layout

```
rust-core/    Rust crate → WASM (parse, disasm, emu, bus)
web/          Vite + Svelte 5 + TS app
docs/         Scope, spec, design notes
scripts/      Build + deploy
```

## Build

```
scripts/build.sh    # rust-core → wasm, then web → dist
scripts/deploy.sh   # rsync web/dist/ → ~/dev/goolz/scry/
```

## Aesthetic

Apothecary spine — full JetBrains Mono, Swiss grid bones, mint stripe on top,
warm off-white surfaces, bracketed semantic state. The daylight cousin of
PEEK.

## Docs

- [Scope document](docs/scope.html) — public-facing project overview
- [Design spec](docs/superpowers/specs/2026-05-11-scry-design.md) — the
  internal contract
