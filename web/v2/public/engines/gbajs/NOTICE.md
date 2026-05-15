# GBA.js (vendored)

This directory vendors the JavaScript GBA emulator originally written by
**Jeffrey Pfau** (endrift) and maintained as the **gbajs2** community
fork by **Andrew Chase** (andychase). Both are licensed under the
2-clause BSD license (see `COPYING`).

The original library dates from 2012-2013 and had not seen active
maintenance in several years. Many of the browser APIs it relied on
(e.g. `webkitAudioContext`, `KeyboardEvent.keyCode`,
`navigator.webkitGetGamepads`, vendor-prefixed gamepad events) have
since been deprecated or removed. To keep the engine running cleanly on
modern browsers, we forked gbajs2 and modernized the codebase, following
FOSS best practices: preserving the BSD-2 license, maintaining full
attribution to both prior authors, and documenting every change.

Upstream:
- Original (archived): <https://github.com/endrift/gbajs>
- Community fork:       <https://github.com/andychase/gbajs2>
- **Our fork**:         <https://github.com/melonmelonz/gbajs2>

## What scry uses it for

scry mounts this emulator on a canvas inside the **GAME** pane of V2
when the loaded file is detected as a GBA cartridge (header byte
0xB2 == 0x96). scry calls the public `GameBoyAdvance` constructor and
methods (`setCanvas`, `setBios`, `setRom`, `runStable`, `pause`,
`reset`).

## Modifications from upstream

The vendored copy includes scry-specific patches (debug logging in
`gba.js`, `video.js`, and `software.js`) on top of the modernization
work in our fork. A summary of the fork-level changes:

| Area | Before | After |
|------|--------|-------|
| Audio | `webkitAudioContext` fallback, `createJavaScriptNode` | Standard `AudioContext`, `createScriptProcessor` only |
| Keyboard input | Deprecated `KeyboardEvent.keyCode` (numeric) | `KeyboardEvent.code` (layout-independent strings) |
| Gamepad input | `webkitGetGamepads()`, vendor-prefixed events | Standard `navigator.getGamepads()` and standard events |
| Gamepad buttons | Raw number comparison | Modern `GamepadButton.pressed` |
| Frame scheduling | `setTimeout`-based | `requestAnimationFrame` / `cancelAnimationFrame` |
| URL API | `window.webkitURL` fallback | Standard `URL` |
| Closures | `var self = this` | Arrow functions with lexical `this` |
| Serializer | Instance methods called statically | Proper `static` declarations |
| OAM prototype | Redundant `Object.create` after `class extends` | Removed |
| Gamepad disconnect | Bug: `self.gamepads` vs `this.gamepads` | Fixed |

No emulation logic was changed. CPU, MMU, IRQ, video renderer, and
audio synthesis are identical to upstream.

## Files vendored

```
js/                  — emulator core (CPU, MMU, PPU, APU, IRQ, keypad, save, etc.)
js/video/            — software renderer + worker proxy
resources/
  bios.bin           — minimal HLE BIOS stub (assembled from bios.S upstream)
  biosbin.js         — same stub, base64-baked into the global `biosBin`
                       so the emulator boots without an XHR/fetch round-trip
  xhr.js             — small XHR helper used by the upstream demo
COPYING              — upstream BSD-2 license (both copyrights)
```
