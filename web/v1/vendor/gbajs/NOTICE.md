# GBA.js (vendored)

This directory vendors the JavaScript GBA emulator originally written by
**Jeffrey Pfau** (endrift), licensed under the 2-clause BSD license
(see `COPYING`). The upstream project is archived at
<https://github.com/endrift/gbajs>.

## What scry uses it for

scry mounts this emulator on a canvas inside the **GAME** pane of V1 when
the loaded file is detected as a GBA cartridge (header byte 0xB2 == 0x96).
No modifications to the upstream sources have been made; scry only calls
the public `GameBoyAdvance` constructor and methods (`setCanvas`,
`setBios`, `setRom`, `runStable`, `pause`, `reset`).

## Files vendored

```
js/          — emulator core (CPU, MMU, PPU, APU, IRQ, keypad, save, etc.)
js/video/    — software renderer + worker proxy
resources/
  bios.bin   — minimal HLE BIOS stub (assembled from bios.S upstream)
  xhr.js     — small XHR helper used by the upstream demo
COPYING      — upstream BSD-2 license
```

## Why archived code

GBA.js was last updated by upstream in 2014. It is BSD-2 licensed,
self-contained, and runs on modern browsers because it depends only on
DataView, Canvas 2D, and Web Audio — all stable web standards. It is
sufficient for booting and playing the demo cartridge for the duration
of the scry class demo.
