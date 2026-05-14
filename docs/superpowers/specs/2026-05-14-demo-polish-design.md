# Demo-polish pass

**Date:** 2026-05-14
**Scope:** Make scry stunning for the 2-minute class demo (see `docs/demo-script.md`).
**Constraint:** Hit both V1 (pure JS) and V2 (Svelte 5 + WASM). Preserve apothecary aesthetic. No new runtime deps for V1.

## Goals

1. Each load-bearing beat in the demo script gets a visible moment of choreography.
2. V1 and V2 stop having visible disparities. The shell should read as one instrument.
3. Polish the "moments of pause" — load, hover, swap — without adding maximalism.

## Shiplist (9 items, all approved)

### Demo amplifiers

1. **Cross-pane jump choreography.** When user clicks a section row in INSPECT or a string hit in STRINGS, HEX:
   - Scrolls to offset using `scrollTo({behavior: 'smooth'})`
   - The destination row (and bytes-within-row) get a `--mint-pale` background flash that fades to transparent over 400ms
   - Implementation: V1 — add `flashRange(start, len)` helper in `web/v1/js/modules/hex.js`; V2 — add `$state` `flashOffset` in `Hex.svelte` with a derived `flashUntil` timestamp.

2. **Entropy strip in V1.** Port V2's entropy ribbon to V1.
   - Compute Shannon entropy over 64 blocks across the buffer (same as V2: `entropy_blocks` semantics)
   - Render as 64 vertical bars in a 36px strip above the hex viewport
   - Click → jump to that block's offset; viewport-position marker slides on scroll
   - Implementation: new module `web/v1/js/hex/entropy.js`, called from `modules/hex.js`. Compute in JS (no WASM in V1).

3. **Mode-swap crossfade.** `web/index.html`:
   - On `setMode()`, fade old iframe out (220ms), wait, mount new iframe, fade in (220ms)
   - Implementation: keep two iframe slots; swap which is `.ready`

4. **File-badge entrance.** When `fileBadge` first paints (V2) / when format detection completes (V1):
   - 250ms slide-in from +8px right, opacity 0→1
   - 1px ink-rule wipes under the badge (scaleX 0→1 from left)

### Unification fixes

5. **Global drag-drop overlay in V2.** Port V1's global overlay pattern to V2.
   - Listen on `window` for `dragenter`/`dragover`/`drop`/`dragleave`
   - Show a full-viewport overlay with "release to load" affordance, even when a file is already loaded
   - On drop: re-run the same load pipeline as Drop.svelte

6. **Left file rail in V2.** Bring V1's left-side FILE / SIZE / FORMAT panel into V2.
   - Width matches V1's rail (`--sp-8 * 4` ish — match the actual computed value)
   - "No file loaded" state when `!file`
   - Tabs move into the main pane (right of the rail) rather than the top chrome — match V1's geometry

### Quiet delight

7. **Hex row mouseover tint.** Both engines: hovered hex row gets `--tint-row` background, 80ms ease.

8. **Theme toggle: crossfade icon.** Moon ↔ sun crossfade over 200ms instead of hard textContent swap. Implementation: stack both icons absolutely, toggle opacity.

9. **Status-bar boot type-out.** First paint only (gated by `sessionStorage` key `scry-booted`):
   - Status bar types `"scry · awaiting binary"` at 60ms/char
   - Once typed, sits idle until file is loaded → then status updates normally

### Visual depth (added)

10. **Mini sparklines in V1's sections table.** V2 has 80px width-scaled bars in the SECTIONS tab; V1's table is text-only. Port them to V1 with the same scale + tokens. Unification + at-a-glance read.

11. **Auto-summary line under the file badge.** Both engines, one line of generated prose:
    > `32-bit RISC-V · 7 sections · 132 symbols · avg entropy 4.2 bits`
    Format adapts to what was actually detected. Calmly informative, makes the workbench feel smart.

12. **Sample picker thumbnails.** Each entry in the EMPTY-state sample picker shows a 12-block entropy sparkline next to its name. Picker stops being a wall of text; the demo "look how different these binaries are" beat works without loading anything. Both engines.

## Demo samples (new — make them visually distinct)

Build two new RV32 ELF samples whose entropy strips and section layouts read as *visibly different* binaries. Current samples are all similar small toys.

- **`demo-strings-bestiary.elf`** — heavy `.rodata` packed with named strings (a poem, fake API endpoints, JEDEC vendor codes). Entropy strip should show an obvious low-entropy plateau where rodata sits, and STRINGS filter has lots to chew on.
- **`demo-noise-chamber.elf`** — has a `.note.scry` (or similar non-loaded section) filled with a pseudo-random byte stream seeded from a known constant. Entropy strip should show a sharp high-entropy band. Demonstrates "binaries have texture."

Both must be valid RV32 ELFs that V1's parser and emulator can still open without crashing (they can be no-op programs; the visual content is the point). Update `scripts/build_samples.mjs` and `web/v1/samples/manifest.json`. V2 reads the same manifest — no separate copy.

## Demo script

Rewrite `docs/demo-script.md` for the gorgeous version. New constraints:
- 2:30 ceiling, but room to breathe
- Walks both V1 and V2 — uses the new mode-swap crossfade as a centerpiece moment
- Highlights at least one beat per item shipped above (where it lands naturally)
- Includes a "panic" appendix: 2 alternative branches if something on stage misbehaves (e.g., demo button doesn't load — fall back to drag-drop of the strings binary)
- Section per beat: WHAT YOU CLICK / WHAT THEY SEE / WHAT YOU SAY (5–15 words each)

## Non-goals

- V2 DISASM/EMU/TRACE parity — out of scope. Disabled tabs in V2 are intentional for the demo.
- Sample manifest changes.
- Build-pipeline changes.
- Adding any framework or runtime dep to V1.

## Verification

- Manual: walk `docs/demo-script.md` end-to-end against the built `web/dist/` served from `python3 -m http.server` at `web/dist/`. Each numbered beat in the demo script must feel snappier than today.
- Visual diff: light + dark mode, both engines, at 1280×800 and 1920×1080.
- No console errors on cold load, demo load, mode swap, or three sequential file drops.

## Rollout

- One feature commit per item where it makes sense to bisect; otherwise grouped per engine.
- After all 9 land: `scripts/build.sh && scripts/deploy.sh` — Pages picks up via goolz git push.
