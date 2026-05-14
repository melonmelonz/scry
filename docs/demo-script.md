# scry — live demo script

A spoken walkthrough designed to land in roughly 2:30 with room to breathe.
Pause beats are marked `[…]`. The script assumes the unified shell at
goolz.org/scry is already open in a tab. Default engine is **V2 (Rust + WASM)**.

Each beat is structured **CLICK** → **SEE** → **SAY** so it's scannable from
the lectern.

---

## 0. Cold open  (≈10 s)

**CLICK:** _nothing yet._
**SEE:** the apothecary chrome — mint stripe, "scry · awaiting binary"
finishing its type-out in the status bar.
**SAY:** "This is **scry**. A binary inspection workbench that lives entirely
in your browser tab. No upload, no login, no install."

---

## 1. The mode picker  (≈10 s)

**CLICK:** point (don't click yet) at the `V1 PURE / V2 RUST·WASM` toggle.
**SEE:** two pills, one lit.
**SAY:** "Two engines share this shell. One's hand-written vanilla JS. The
other — the one we're on — is a Rust core compiled to WebAssembly. Same
workbench, two implementations."

---

## 2. Auto-summary entrance via a sample ELF  (≈15 s)

**CLICK:** `demo-fib10.elf` in the OR-PICK-A-SAMPLE row of the landing pane.
**SEE:** iframe crossfades; the badge `[ ELF · RISC-V · 32-bit · EXEC ]`
slides in from the right with a 1-pixel ink rule wiping under it; an
auto-summary line — _"32-bit RISC-V · N sections · N symbols · avg entropy
X bits"_ — fades in beneath it.
**SAY:** "Browser fetches a real RISC-V ELF and parses it locally. The
header chip and that summary line came out of the parser, not the filename."

---

## 3. INSPECT — sparkline sections + click-to-jump  (≈20 s)

**CLICK:** `SECTIONS` tab → any `.text`-row.
**SEE:** size sparklines on the right pin to the heavy hitters; clicked row
flashes mint; **HEX** opens at that offset with the destination bytes
flash-tinted mint and fading to paper.
**SAY:** "Sections table — note the mint bars on the right; size at a
glance. Every row is a jump. Click it, and the hex view lands on the bytes
that row describes."

---

## 4. HEX — entropy ribbon, texture navigation  (≈20 s)

**CLICK:** point at the entropy strip across the top.
**SEE:** 64 ink bars, the file's Shannon shape.
**SAY:** "This is the entropy strip. Code looks like rolling hills. Strings
flatten out. Compressed or encrypted blobs pin to the top."

**CLICK:** a tall column.
**SEE:** viewport scrolls; bytes-within-row flash.
**SAY:** "You can navigate the file by texture, not address."

---

## 5. Load the strings bestiary — STRINGS triage  (≈25 s)

**CLICK:** `DEMOS` → `demo-strings-bestiary.elf`.
**SEE:** entropy strip changes shape — a low plateau where `.rodata` sits;
auto-summary updates.
**SAY:** "Every demo has its own fingerprint. This one's heavy on rodata —
you can _see_ that plateau."

**CLICK:** `INSPECT` → `STRINGS` tab → type `JEDEC` in the filter.
**SEE:** hits filter down; offsets show on the right.
**SAY:** "Printable runs, indexed by offset, everything still a jump. Triage
an unknown binary in about ten seconds: shape from entropy, intent from
strings."

---

## 6. Load the noise chamber — high-entropy beat  (≈15 s)

**CLICK:** `DEMOS` → `demo-noise-chamber.elf`.
**SEE:** entropy strip now has a sharp wall — the PRNG-filled `.scry.noise`
section.
**SAY:** "Same workbench, different binary. That spike is a section
deliberately filled with pseudorandom bytes — exactly what packed or
encrypted data looks like."

---

## 7. The WAVE pane — a different kind of binary  (≈25 s)

**CLICK:** `DEMOS` → `demo-sine-sweep.wav`.
**SEE:** the WAVE tab lights up; auto-routes to it; header panel shows
"PCM · 1ch · 8000 Hz · 16-bit · 1.50 s"; a waveform paints across the canvas
showing the chirp envelope.
**SAY:** "Scry isn't only an ELF tool. Same shell parses RIFF/WAVE. Hand-
rolled parser; the canvas is a peak-and-RMS envelope, decoded down to
Float32."

**CLICK:** `PLAY`.
**SEE:** mint playhead sweeps across the canvas; status clock counts up.
**SAY:** "And the same buffer goes straight into Web Audio. No round-trip
through a server."

---

## 8. The engine swap  (≈15 s)

**CLICK:** `V1 PURE`.
**SEE:** mode-swap crossfade; same file, same view, same waveform; status
bar swaps to `RUST·WASM` → `PURE JS`.
**SAY:** "Same instrument. Different engine. Vanilla JS, no build step. V1
is the receipt that I can write the primitives; V2 is the receipt that I
can ship them the way a real product would ship."

---

## 9. The centerpiece — running Pokemon Emerald  (≈30 s)

**CLICK:** still on `V1 PURE`. From the landing pane, pick
`demo-pokemon-emerald.gba`. (If already loaded, click `scry` in the top-left
to clear, then re-pick.)
**SEE:** auto-routes to the new GAME tab. Left pane: a black 480×320 canvas
boots into the Nintendo logo + Game Freak intro. Right pane: the cartridge
header dump — TITLE `POKEMON EMER`, CODE `BPEE`, fixed byte `0x96 ✓`,
checksum, ROM size 16 MiB, plus a hex window of bytes 0xA0–0xDF.
**SAY:** "This is a 16-megabyte GBA cartridge I dumped from my own copy
twenty-plus years ago. Drop it in, V1 detects the header signature, mounts
a vendored pure-JS GBA emulator on a canvas, and — that's the game running
in this tab. On the right, the same bytes the emulator just parsed: title,
game code, the Nintendo fixed byte. Same workbench, just a different
kind of binary."

**CLICK:** `PAUSE`, then click into the right-pane hex.
**SAY:** "Pause the game, inspect the bytes, hit play. That's the
half-game-console, half-debugger story scry is making."

---

## 10. Same cart, the other engine  (≈15 s)

**CLICK:** `V2 RUST·WASM`. Re-pick `demo-pokemon-emerald.gba`.
**SEE:** lands on the new `CART` pane. Header decoded by Rust;
checksum verified by recomputing it from bytes 0xA0..=0xBC.
**SAY:** "V2 doesn't run the game yet — but its Rust core parses the
cartridge header and recomputes the Nintendo checksum. Different story
on the same file. The tech-breakdown link at the top has the full
side-by-side."

---

## 11. The pitch  (≈10 s)

**SAY:** "Everything you just saw is local. The bytes never leave the tab —
goolz.org serves a static bundle. Source is open, the Rust core is a normal
`cargo`-buildable crate, and the roadmap keeps the disasm and emulator
panes growing without ever shipping a backend."

---

## Cheat sheet (printable)

| Step | CLICK                                  | SAY (key line)                                  |
| ---- | -------------------------------------- | ----------------------------------------------- |
| 0    | _(nothing)_                                  | "Binary inspection workbench, no upload."       |
| 1    | point at mode picker                         | "Two engines, same shell."                      |
| 2    | sample row → `demo-fib10.elf`                | "Real RV32 ELF, parsed in-browser."             |
| 3    | `SECTIONS` → row                             | "Every row is a jump."                          |
| 4    | tall entropy column                          | "Navigate by texture, not address."             |
| 5    | bestiary → `STRINGS` → filter `JEDEC`        | "Shape from entropy, intent from strings."      |
| 6    | noise-chamber                                | "Packed data has a fingerprint."                |
| 7    | `demo-sine-sweep.wav` → `PLAY`               | "Same shell, RIFF parser, Web Audio out."       |
| 8    | swap to `V1 PURE`                            | "Same instrument, different engine."            |
| 9    | `demo-pokemon-emerald.gba` (V1)              | "Same workbench. Now it's running a game."      |
| 10   | swap to `V2 RUST·WASM`, re-pick the cart     | "Rust verifies the cartridge checksum."         |
| 11   | _(nothing)_                                  | "Everything's local."                           |

---

## Panic appendix — two recovery branches

**Branch A — sample row sample fails to fetch.**
Drag-drop a binary onto the page (global drop overlay catches anywhere).
Skip step 2; go straight to step 3.

**Branch P — Pokemon Emerald won't boot (gbajs init error, audio policy).**
Skip step 9's PLAY narrative. Stay on the hex/header pane on the right —
that's the actual point of the workbench. Pivot: "The point isn't that
it's a game; it's that the same UI that just dissected an ELF and a WAV
now dissects a 16-megabyte cartridge. The header parsed; the bytes are
right there." Then click `V2 RUST·WASM` and pick the cart again — V2's
CART pane will still show the Rust-verified header.

**Branch B — WAV pane fails to play (autoplay-policy / no audio device).**
Skip step 7's PLAY click. Stay on the canvas, hover the playhead to show
the seek timestamp. Pivot the line: "The viewer works even when the
browser blocks audio — the envelope is decoded statically, the playback
is a layered nicety."

**Branch C — Mode swap looks broken on stage.**
Refresh the tab. The session storage flag will skip the boot-typeout but
otherwise it's a clean start. The mint stripe wipes again on cold load.

---

## Pre-flight (60 s before going on stage)

1. Tab open at `goolz.org/scry`, V2 selected, theme matching the room
   (dark for projector, light for laptop screen-share).
2. Hit F5 once so the boot type-out gets a fresh stage entrance.
3. Mouse positioned near the sample row.
4. Browser console closed.
5. Audio output verified — quick play of the sine-sweep sample in a
   separate tab, just to confirm the room's audio is live.
6. Smoke-test the Pokemon Emerald boot in V1 _once_ before the demo: pick
   the sample, hit PLAY, watch the Nintendo logo paint. gbajs warms up its
   HLE BIOS on first ROM load.
