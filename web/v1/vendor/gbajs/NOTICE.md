# GBA.js (vendored)

This directory vendors the JavaScript GBA emulator originally written by
**Jeffrey Pfau** (endrift) and maintained as the **gbajs2** community
fork by **Andrew Chase** (andychase). Both are licensed under the
2-clause BSD license (see `COPYING`).

Upstream:
- Original (archived): <https://github.com/endrift/gbajs>
- Active fork:         <https://github.com/andychase/gbajs2>

## What scry uses it for

scry mounts this emulator on a canvas inside the **GAME** pane of V1 when
the loaded file is detected as a GBA cartridge (header byte 0xB2 == 0x96).
No modifications to the upstream sources have been made; scry only calls
the public `GameBoyAdvance` constructor and methods (`setCanvas`,
`setBios`, `setRom`, `runStable`, `pause`, `reset`).

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
