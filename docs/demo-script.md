# scry — 2-minute live demo script

A spoken walkthrough designed to land in roughly 120 seconds. Pause beats
are marked `[…]`. The script assumes the unified shell at goolz.org/scry is
already open in a tab on V2 (the Rust + WASM engine, default).

---

## 0. Cold open  (≈10 s)

> "This is **scry**. It's a binary inspection workbench that runs entirely
> in your browser — no upload, no login, no install. Two engines share the
> same chrome: a vanilla-JS reference build, and the one we're looking at
> now, written in Rust and compiled to WebAssembly."

Point at the top-right `V1 / V2` toggle. Don't click yet.

## 1. The DEMO button  (≈15 s)

Click **DEMO** in the top chrome.

> "I'm going to skip the file-picker. The shell ships with a synthesized
> RISC-V 32-bit ELF — a tiny program that adds two registers and exits.
> It's built in the browser, byte-by-byte, so we always have something
> real to inspect even if you've never touched a binary in your life."

The iframe fades, repaints, lands on the `INSPECT` tab with the file badge
populated. Highlight the bracketed chip in the header:

> "Top-right: **ELF · RISC-V · 32-bit · EXEC**. That comes out of the
> parser, not the filename."

## 2. INSPECT — the structure pane  (≈25 s)

Stay on `SUMMARY` for one beat.

> "ELF header summary on the left — class, data, OS/ABI, machine, entry
> point. Boring, but it's the truth."

Click `SECTIONS`.

> "Sections table. Note the little mint bars on the right — that's a
> size sparkline, so you can spot the heavy hitters at a glance."

Click any `.text`-ish row.

> "And every row is a jump. Click it…"

The view switches to `HEX` at that offset.

## 3. HEX — the entropy strip  (≈25 s)

Point at the strip across the top of the hex grid.

> "This is the **entropy strip**. Each column is one block of the file;
> the height is its normalized Shannon entropy. Code looks like rolling
> hills. Strings look flat. Compressed or encrypted blobs look like a
> wall — they pin to the top."

Click a high-entropy column.

> "Click anywhere on it and the viewer jumps. The red line is your current
> viewport. So you can navigate a megabyte file by *texture*, not by
> address."

Type `0x54` into the `@` box, Enter.

> "Or just type a hex offset."

## 4. STRINGS — fast triage  (≈20 s)

Click `INSPECT` → `STRINGS`.

> "Printable runs of four or more bytes, indexed by offset. Filterable.
> Everything's still a jump — click one, you land in HEX at that exact
> byte."

Type `RISC` into the filter, click the result.

> "That's how you triage an unknown binary in about ten seconds: skim
> entropy for shape, skim strings for intent."

## 5. The V1 / V2 switch  (≈15 s)

Click `V1 PURE` in the top chrome.

> "Same workbench, vanilla JavaScript — no Rust, no Wasm. Useful as a
> reference: anything V2 can do, V1 should be able to do too. It's the
> control group for the optimization story."

Click `V2 RUST·WASM` back.

## 6. The pitch  (≈10 s)

> "Everything you just saw is **local**. The bytes never leave the tab —
> goolz.org just serves the static bundle. Source is open, the parser is
> a normal `cargo`-buildable crate, and the design intent is to keep
> growing the disasm and emulator panes without ever shipping a backend."

---

## Cheat sheet (printable)

| Step | Click                     | Say (key line)                                |
| ---- | ------------------------- | --------------------------------------------- |
| 1    | `DEMO`                    | "Synthesized RV32 ELF, built in the browser." |
| 2    | `SECTIONS` → any row      | "Every row is a jump."                        |
| 3    | a tall entropy column     | "Navigate by texture, not address."           |
| 4    | `STRINGS` → filter `RISC` | "Triage in ten seconds."                      |
| 5    | `V1 PURE` ↔ `V2 RUST·WASM`| "Control group for the optimization story."   |
| 6    | (none)                    | "Everything's local."                         |

## If something goes wrong

- **Blank pane after DEMO**: hit `V1` then `V2` to remount the iframe.
- **HEX doesn't jump on row click**: the row sends to the parent first.
  Refresh the iframe — usually a race with `ensureWasm()` on cold start.
- **Entropy strip missing**: the file is smaller than 128 bytes; pick a
  bigger sample or stay on the bundled demo.
- **Theme out of sync between chrome and iframe**: click the moon/sun
  toggle once to force a `postMessage` resync.
