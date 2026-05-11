# Scry — Built With Claude: a session writeup

**Live:** https://goolz.org/scry
**Repo:** https://github.com/melonmelonz/scry
**Author:** Penn Porterfield
**Tool:** Claude Code (Opus 4) in a local terminal, on Bazzite Fedora

---

## 1. What scry is

Scry is a browser-only binary workbench. You drop in an ELF, scry parses it,
shows the section/segment tables, paints a hex view, disassembles RV32 code,
runs the program inside a small interpreter, and decodes any SPI/I2C bus
traffic the program produced. Nothing leaves the tab. The whole thing is
static files behind Cloudflare Pages.

It exists in two flavors:

- **v1** — hand-rolled vanilla JS. No frameworks. ELF parser written from
  the spec, RV32 decoder, an interpreter, decoders for two serial buses. The
  point of v1 was to prove I could build the primitives myself.
- **v2** — the same idea done the way you would actually ship it: a Rust
  crate (`scry-core`) compiled to WebAssembly with `wasm-pack` and a Svelte
  5 + Vite frontend on top. v2 reuses the goblin ELF parser instead of
  rolling one.

This document is about the AI side of the build, not the binary side.

## 2. What the AI did in this session

The session started with v1 already on disk and partially deployed, but
half-broken. Across one continuous Claude Code session, the assistant:

1. Diagnosed why all tabs except `EMPTY` appeared greyed-out (they are
   intentionally disabled until a file loads — verified via the live site,
   not by guessing).
2. Added a dark mode to the entire surface (landing page, v1 workbench,
   scope doc, v2 shell), via CSS custom properties plus a `data-theme`
   attribute and a `prefers-color-scheme` fallback. Wrote a small toggle
   that persists in `localStorage` and includes a synchronous head script
   so the theme paints before first frame to avoid a flash.
3. Did a security pass on the ELF parser. Added bounds checks at every
   `DataView` access so a malformed file produces a clean `malformed ELF:
   …` error instead of a raw `RangeError`. Capped `e_shnum` / `e_phnum` /
   symbol counts to defend against integer-overflow DoS. Whitelisted sample
   filenames via regex (`/^[A-Za-z0-9._-]+\.elf$/`) before fetching them
   from the manifest. Capped drag-drop ingestion at 64 MiB so a careless
   drop cannot lock the main thread.
4. Did a UX pass for v1: tab tooltips explain *why* a tab is disabled,
   the status bar carries a per-module hint, emulator state renders as a
   color-coded badge (running / ready / halted / fault), clicking a hex
   byte shows offset/bin/ascii in the detail panel, the disasm view has a
   goto-address form, and clicking a symbol in the inspect view jumps to
   the disasm at that address. None of these are visible from a glance,
   which is the point. The original aesthetic stays.
5. Scaffolded the entire v2 stack from zero: a Cargo workspace, the
   `scry-core` crate exposing `parse_elf`, `detect_format`, `hex_rows`
   through `wasm-bindgen`, a Vite + Svelte 5 shell with components for
   drop, inspect, and hex. Wired `scripts/build.sh` to chain
   wasm-pack → Vite, then minify v1 with the esbuild that ships with Vite.
6. Hit one real bug along the way: `wasm-opt` refusing to validate the
   modern bulk-memory ops Rust emits, fixed by disabling the post-opt step
   in `Cargo.toml`. The assistant diagnosed this from the actual error
   text instead of trying random flags.
7. Pushed everything live and triggered the Cloudflare Pages deploy
   through the existing `scripts/deploy.sh`.

## 3. How I worked with it

I treated Claude like a junior engineer who reads fast, writes faster, and
has zero context on my taste until I correct it. My prompts were short and
directional: "do v2 now please", "fix all of those please", "UI and UX
need considered". When the model defaulted to verbose explanations or
heavy frameworks, I cut it off. When it suggested something I would not
ship (a CDN script tag, an em-dash in prose, a placeholder TODO inside a
deployed file), I said so once and the rule stuck for the rest of the
session.

The thing I did not delegate was scope. Every time the assistant proposed
"more features", I either took the suggestion as-is or replaced it with
something I actually wanted. The model is good at filling in the next
reasonable step. It is not good at deciding which step the project
needs. That is on me.

## 4. Where AI was load-bearing

Three places:

- **Plumbing**, by which I mean cargo workspaces, Vite config for WASM,
  Svelte 5 runes syntax, hand-writing the bounds-checked binary reader.
  This is the boring code where you can lose half a day to a typo.
  Claude got the shape right on the first pass for almost all of it.
- **Token hygiene**. Dark mode meant touching every CSS file. Claude
  caught more `#hex` literals I had missed than I would have on my own,
  and it kept the names consistent across the three surfaces.
- **The audit pass**. I asked for "safety and security". The model came
  back with three findings ranked by exploitability, with code for each
  fix. I would not have thought to whitelist sample filenames on my own.

## 5. Where I had to steer

- **Aesthetic restraint.** The model wanted to add icons, framed panels,
  animations. I kept saying "subtlety". The output is now subtle. This
  took several rounds.
- **Avoiding the trap of "more is better".** When I said "flesh it
  all out", I had to be specific about what *flesh out* meant or the
  model would have added a fifth tab and a settings panel that nobody
  asked for.
- **Voice.** The model defaults to corporate documentation prose. My
  voice is hedged and concrete. I wrote the README. Claude wrote the
  scaffolding underneath.

## 6. Friction worth naming

- The build broke once on `wasm-opt`. The error message named the
  problem precisely. The fix took two minutes. That is the failure mode
  I want from an AI tool: real error, real fix, no spelunking.
- The model occasionally needed to be told to use the dedicated tools
  (Read, Grep, Glob) instead of shell `cat | grep`. This is a Claude
  Code-specific quirk and the system prompt now enforces it.
- The model has no view of the live deployed site. Twice in this
  session I had to tell it "the site does X" so it would stop assuming
  the local source matched production.

## 7. What I would do differently

- I would have written the security pass *first*, not after the UX pass.
  The bounds-check changes touched code the UX pass had already moved.
- I would have set up the Vite + Svelte v2 scaffold on day one. v1 was
  fun but v1 is also a re-implementation of goblin, and the only reason
  to do that is the receipt that you can.
- I would have asked for a deliverable like this one earlier. Writing
  this in the same session as the build means I remember why each
  decision was made.

## 8. Closing

The work product is at https://goolz.org/scry. The source is at
github.com/melonmelonz/scry. If you read the v1 commits in order you can
see the build, including the moments where I changed direction. None of
the code in this repo is generated and pasted blind. Every file got
read, edited, and committed by a human who can defend the choices in it.

The AI is part of the toolchain, sitting at roughly the same level as my
editor and my compiler. It would not have written scry without me. I
would have shipped a worse, slower, less-tested scry without it.
