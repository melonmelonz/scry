# Scry Enhancements: V2 Parity, MiniHex Overlays, Landmarks, Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring v2 HEX to feature parity with v1, add GBA header overlays to MiniHex, add demo-friendly landmarks to GAME, default follow to ON, and add visual polish across both engines.

**Architecture:** All changes are additive to existing modules. v1 and v2 stay in lockstep — every feature lands in both. No new files; we import existing shared schemas (overlays.js, gba/map.js) into MiniHex modules. V2 HEX gets rewritten from pagination to capped-sizer virtual scrolling matching v1's approach.

**Tech Stack:** Vanilla JS (v1), Svelte 5 (v2), CSS keyframes

---

### Task 1: Default follow to ON + auto-enable on play

**Files:**
- Modify: `web/v1/js/stores/gamepc.js:4`
- Modify: `web/v1/js/modules/game.js:36,62,295-301,314,346`
- Modify: `web/v2/src/lib/Game.svelte:30,196-199,219-249`

This is small but high-impact. Follow starts ON so the user sees it working immediately on PLAY.

- [ ] **Step 1: Flip the gamepc store default**

In `web/v1/js/stores/gamepc.js`, change line 4:
```javascript
// was: follow: false,
follow: true,
```

- [ ] **Step 2: Update v1 game.js init**

In `web/v1/js/modules/game.js`, change the initial state and button:
```javascript
// line 36 — was: let follow = false;
let follow = true;
```

And after followBtn is created (after line 64), add:
```javascript
followBtn.classList.add('g-follow-on');
followLab.textContent = 'FOLLOWING PC';
```

Update the miniHex init to pass follow state (after line 79):
```javascript
miniHex.setFollow(true);
```

In the file-reset handler (gameFileSub, ~line 314), when bytes are null, keep follow reset to true instead of false:
```javascript
// was: follow = false;
follow = true;
followBtn.classList.add('g-follow-on');
followLab.textContent = 'FOLLOWING PC';
```

- [ ] **Step 3: Update v2 Game.svelte init**

In `web/v2/src/lib/Game.svelte`, change line 30:
```javascript
// was: let follow = $state(false);
let follow = $state(true);
```

In the `$effect` that resets on bytes change (~line 229), change:
```javascript
// was: follow = false;
follow = true;
```

- [ ] **Step 4: Manual smoke test**

Load a GBA cart in both v1 and v2. Verify:
- FOLLOW PC button starts lit (LED filled, label says "FOLLOWING PC")
- On PLAY, MiniHex and HEX tab auto-scroll to track PC
- Toggling off works, toggling back on works
- Loading a new file resets to follow ON

- [ ] **Step 5: Commit**

```bash
git add web/v1/js/stores/gamepc.js web/v1/js/modules/game.js web/v2/src/lib/Game.svelte
git commit -m "game: default follow to ON so PC tracking is visible immediately"
```

---

### Task 2: CSS animations — PC cursor pulse, entropy hover glow, select pop

**Files:**
- Modify: `web/v1/css/hex.css`
- Modify: `web/v1/css/game.css`
- Modify: `web/v2/src/lib/Hex.svelte` (style block)
- Modify: `web/v2/src/lib/MiniHex.svelte` (style block)

Pure CSS, zero crash risk. Adds visual polish that makes the tool feel alive.

- [ ] **Step 1: Add PC cursor pulse to v1 hex.css**

Append to `web/v1/css/hex.css`:
```css
/* ─── PC cursor pulse (follow mode) ──────────── */
@keyframes pc-pulse {
  0%, 100% { outline-color: var(--mint-deep); }
  50%      { outline-color: transparent; }
}
.hex-row .bytes [data-fi].pc-active,
.hex-row .ascii [data-fi].pc-active {
  outline: 2px solid var(--mint-deep);
  outline-offset: -1px;
  animation: pc-pulse 1.2s ease-in-out infinite;
}

/* ─── Entropy bar hover glow ─────────────────── */
.hex-entropy-bar:hover .hex-entropy-fill {
  background: var(--mint-deep);
  box-shadow: 0 0 6px var(--mint-deep);
}

/* ─── Byte select pop ────────────────────────── */
@keyframes byte-pop {
  0%  { transform: scale(1); }
  40% { transform: scale(1.3); }
  100% { transform: scale(1); }
}
.hex-row .bytes [data-fi].sel,
.hex-row .ascii [data-fi].sel {
  animation: byte-pop 200ms ease-out;
}
```

- [ ] **Step 2: Add PC cursor pulse to v1 game.css (MiniHex section)**

Append to `web/v1/css/game.css`:
```css
/* ─── PC byte pulse ──────────────────────────── */
@keyframes mh-pc-pulse {
  0%, 100% { outline-color: var(--mint-deep); }
  50%      { outline-color: transparent; }
}
.mh-cell.mh-pc-byte, .mh-char.mh-pc-byte {
  animation: mh-pc-pulse 1.2s ease-in-out infinite;
}

/* ─── Byte select pop ────────────────────────── */
@keyframes mh-byte-pop {
  0%  { transform: scale(1); }
  40% { transform: scale(1.3); }
  100% { transform: scale(1); }
}
.mh-cell.mh-selected, .mh-char.mh-selected {
  animation: mh-byte-pop 200ms ease-out;
}
```

- [ ] **Step 3: Mirror pulse + pop in v2 Hex.svelte style block**

Add inside `<style>` in `web/v2/src/lib/Hex.svelte`:
```css
@keyframes pc-pulse {
  0%, 100% { outline-color: var(--mint-deep); }
  50%      { outline-color: transparent; }
}
.byte.pc-active, .char.pc-active {
  outline: 2px solid var(--mint-deep);
  outline-offset: -1px;
  animation: pc-pulse 1.2s ease-in-out infinite;
}
.strip-col:hover {
  background: var(--mint-deep);
  box-shadow: 0 0 6px var(--mint-deep);
}
@keyframes byte-pop {
  0%  { transform: scale(1); }
  40% { transform: scale(1.3); }
  100% { transform: scale(1); }
}
.byte.sel, .char.sel {
  animation: byte-pop 200ms ease-out;
}
```

- [ ] **Step 4: Mirror pulse + pop in v2 MiniHex.svelte style block**

Add inside `<style>` in `web/v2/src/lib/MiniHex.svelte`:
```css
@keyframes mh-pc-pulse {
  0%, 100% { outline-color: var(--mint-deep); }
  50%      { outline-color: transparent; }
}
:global(.mh-cell.mh-pc-byte), :global(.mh-char.mh-pc-byte) {
  animation: mh-pc-pulse 1.2s ease-in-out infinite;
}
@keyframes mh-byte-pop {
  0%  { transform: scale(1); }
  40% { transform: scale(1.3); }
  100% { transform: scale(1); }
}
:global(.mh-cell.mh-selected), :global(.mh-char.mh-selected) {
  animation: mh-byte-pop 200ms ease-out;
}
```

- [ ] **Step 5: Commit**

```bash
git add web/v1/css/hex.css web/v1/css/game.css web/v2/src/lib/Hex.svelte web/v2/src/lib/MiniHex.svelte
git commit -m "css: add PC cursor pulse, entropy hover glow, byte select pop animation"
```

---

### Task 3: MiniHex — GBA header overlays + binary detail

**Files:**
- Modify: `web/v1/js/modules/minihex.js`
- Modify: `web/v2/src/lib/MiniHex.svelte`
- Modify: `web/v1/css/game.css`

Add GBA header overlay coloring to MiniHex bytes so the header region (0x00-0xBF) shows colored field boundaries. Enhance the detail bar with binary representation and field info on hover.

- [ ] **Step 1: Add overlay support to v1 MiniHex**

In `web/v1/js/modules/minihex.js`, add imports at the top (after line 1 comment block, before the existing import):
```javascript
import { GBA_HEADER_OVERLAY, findOverlayAt, decodeField, formatDecoded } from '../hex/overlays.js';
```

Update `paintCellRun` to add overlay classes (replace the function at lines 69-82):
```javascript
function paintCellRun(host, cells, selectedOffset, cursorOffset, hotField) {
  host.textContent = '';
  cells.forEach((cell, idx) => {
    const f = findOverlayAt(GBA_HEADER_OVERLAY, cell.off);
    const classes = ['mh-cell'];
    if (f) classes.push('mh-ovr');
    if (hotField && f === hotField) classes.push('mh-hot');
    if (cell.off === selectedOffset) classes.push('mh-selected');
    if (cell.off === cursorOffset) classes.push('mh-pc-byte');
    const s = el('span', {
      class: classes.join(' '),
      dataset: { off: String(cell.off) },
      text: cell.text,
    });
    host.appendChild(s);
    if (idx < cells.length - 1) {
      host.appendChild(document.createTextNode(cell.gap === 'wide' ? '  ' : ' '));
    }
  });
}
```

Update `paintAsciiRun` similarly (replace lines 84-93):
```javascript
function paintAsciiRun(host, cells, selectedOffset, cursorOffset, hotField) {
  host.textContent = '';
  cells.forEach(cell => {
    const f = findOverlayAt(GBA_HEADER_OVERLAY, cell.off);
    const classes = ['mh-char'];
    if (f) classes.push('mh-ovr');
    if (hotField && f === hotField) classes.push('mh-hot');
    if (cell.off === selectedOffset) classes.push('mh-selected');
    if (cell.off === cursorOffset) classes.push('mh-pc-byte');
    host.appendChild(el('span', {
      class: classes.join(' '),
      dataset: { off: String(cell.off) },
      text: cell.text,
    }));
  });
}
```

Add a `hoveredField` variable inside `createMiniHex` (after `let followOn = false;`):
```javascript
let hoveredField = null;
```

Update the `render()` function's inner loop to pass `hoveredField` (in lines 161-173):
```javascript
// Replace the two paint calls:
paintCellRun(h, cells.hex, selectedOffset, cursorOffset, hoveredField);
paintAsciiRun(c, cells.asc, selectedOffset, cursorOffset, hoveredField);
```

Update `renderDetail()` (replace lines 230-243) to show field info + binary:
```javascript
function renderDetail() {
  const off = selectedOffset >= 0 ? selectedOffset : cursorOffset;
  const f = findOverlayAt(GBA_HEADER_OVERLAY, off);
  if (f && bytes) {
    const v = decodeField(bytes, f);
    detail.textContent = `${f.name} \u00B7 ${formatDecoded(v, f)}${f.description ? ' \u00B7 ' + f.description : ''}`;
    return;
  }
  const d = byteDetail(bytes, off);
  if (!d) {
    detail.textContent = bytes ? 'select a byte' : 'no ROM loaded';
    return;
  }
  const bin = d.v.toString(2).padStart(8, '0');
  const bits = [
    `OFF ${hex8(d.off)}`,
    `BYTE 0x${hex2(d.v)} (${d.v})`,
    `b${bin}`,
    `ASCII '${d.ascii}'`,
  ];
  if (d.u16 !== null) bits.push(`U16LE 0x${d.u16.toString(16).toUpperCase().padStart(4, '0')}`);
  if (d.u32 !== null) bits.push(`U32LE 0x${d.u32.toString(16).toUpperCase().padStart(8, '0')}`);
  detail.textContent = bits.join(' \u00B7 ');
}
```

Add hover delegation on the scroll container (before the existing click handler, ~before line 253):
```javascript
scroll.addEventListener('mouseover', (e) => {
  const t = e.target.closest('[data-off]');
  if (!t || !bytes) { return; }
  const off = Number(t.dataset.off);
  const f = findOverlayAt(GBA_HEADER_OVERLAY, off);
  if (f !== hoveredField) {
    hoveredField = f;
    render();
  }
});
scroll.addEventListener('mouseleave', () => {
  if (hoveredField) { hoveredField = null; render(); }
});
```

- [ ] **Step 2: Add overlay CSS to v1 game.css**

Append to the MiniHex section of `web/v1/css/game.css`:
```css
/* ─── MiniHex overlays ───────────────────────── */
.mh-cell.mh-ovr, .mh-char.mh-ovr {
  background: var(--mint-pale);
}
.mh-cell.mh-ovr:hover, .mh-char.mh-ovr:hover {
  background: var(--mint);
  cursor: help;
}
.mh-cell.mh-hot, .mh-char.mh-hot {
  background: var(--mint);
}
```

- [ ] **Step 3: Add overlay support to v2 MiniHex.svelte**

In `web/v2/src/lib/MiniHex.svelte`, add the GBA header overlay inline at the top of the script (after the utility functions, around line 41):
```javascript
const GBA_HEADER_OVERLAY = [
  { offset: 0x000, size: 4,   name: 'entry.branch',     type: 'bytes',  description: 'ARM branch' },
  { offset: 0x004, size: 156, name: 'nintendo.logo',     type: 'bytes',  description: 'Nintendo logo bitmap' },
  { offset: 0x0A0, size: 12,  name: 'game.title',        type: 'string', description: 'Cartridge title' },
  { offset: 0x0AC, size: 4,   name: 'game.code',         type: 'string', description: 'Game code' },
  { offset: 0x0B0, size: 2,   name: 'maker.code',        type: 'string', description: 'Maker code' },
  { offset: 0x0B2, size: 1,   name: 'fixed.0x96',        type: 'u8',     description: 'BIOS fixed byte' },
  { offset: 0x0B3, size: 1,   name: 'unit.code',         type: 'u8' },
  { offset: 0x0B4, size: 1,   name: 'device.type',       type: 'u8' },
  { offset: 0x0B5, size: 7,   name: 'reserved',          type: 'bytes' },
  { offset: 0x0BC, size: 1,   name: 'software.version',  type: 'u8' },
  { offset: 0x0BD, size: 1,   name: 'complement.checksum', type: 'u8', description: 'Header checksum' },
  { offset: 0x0BE, size: 2,   name: 'reserved.tail',     type: 'bytes' },
];

function findOverlayAt(off) {
  for (const f of GBA_HEADER_OVERLAY) {
    if (off >= f.offset && off < f.offset + f.size) return f;
  }
  return null;
}

function readOverlayValue(f) {
  if (!bytes || f.offset + f.size > bytes.byteLength) return '-';
  if (f.type === 'string') {
    return Array.from(bytes.subarray(f.offset, f.offset + f.size))
      .map(b => b >= 0x20 && b <= 0x7E ? String.fromCharCode(b) : '.').join('').trim();
  }
  if (f.type === 'u8') return `0x${hex2(bytes[f.offset])} (${bytes[f.offset]})`;
  return Array.from(bytes.subarray(f.offset, f.offset + f.size)).map(hex2).join(' ');
}

let hoveredField = $state(null);
```

Update `paintRun` to add overlay classes (replace lines 79-94):
```javascript
function paintRun(host, cells, cls, cursorOffset) {
  host.textContent = '';
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const s = document.createElement('span');
    s.className = cls;
    const f = findOverlayAt(cell.off);
    if (f) s.classList.add('mh-ovr');
    if (hoveredField && f === hoveredField) s.classList.add('mh-hot');
    if (cell.off === selectedOffset) s.classList.add('mh-selected');
    if (cell.off === cursorOffset) s.classList.add('mh-pc-byte');
    s.dataset.off = String(cell.off);
    s.textContent = cell.text;
    host.appendChild(s);
    if (cls === 'mh-cell' && i < cells.length - 1) {
      host.appendChild(document.createTextNode(cell.gap === 'wide' ? '  ' : ' '));
    }
  }
}
```

Update `selectedDetail()` (replace lines 96-112) to show field info + binary:
```javascript
function selectedDetail() {
  const off = selectedOffset ?? cursor;
  if (!bytes || typeof off !== 'number' || off < 0 || off >= bytes.byteLength) return null;
  const f = findOverlayAt(off);
  if (f) {
    const v = readOverlayValue(f);
    return `${f.name} \u00B7 ${v}${f.description ? ' \u00B7 ' + f.description : ''}`;
  }
  const v = bytes[off];
  const bin = v.toString(2).padStart(8, '0');
  const u16 = off + 1 < bytes.byteLength ? (bytes[off] | (bytes[off + 1] << 8)) : null;
  const u32 = off + 3 < bytes.byteLength
    ? ((bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0)
    : null;
  const parts = [
    `OFF ${hex8(off)}`,
    `BYTE 0x${hex2(v)} (${v})`,
    `b${bin}`,
    `ASCII '${asciiCh(v)}'`,
  ];
  if (u16 !== null) parts.push(`U16LE 0x${u16.toString(16).toUpperCase().padStart(4, '0')}`);
  if (u32 !== null) parts.push(`U32LE 0x${u32.toString(16).toUpperCase().padStart(8, '0')}`);
  return parts.join(' \u00B7 ');
}
```

Add hover handlers on the scroll div (add `onmouseover` and `onmouseleave` to the `mh-scroll` div):
```svelte
<div class="mh-scroll" bind:this={scroll} role="grid" tabindex="0"
  onclick={onScrollClick} onkeydown={onScrollKeydown}
  onmouseover={onScrollHover} onmouseleave={onScrollLeave}>
```

Add the handler functions:
```javascript
function onScrollHover(e) {
  const t = e.target.closest('[data-off]');
  if (!t || !bytes) return;
  const off = Number(t.dataset.off);
  const f = findOverlayAt(off);
  if (f !== hoveredField) { hoveredField = f; render(); }
}
function onScrollLeave() {
  if (hoveredField) { hoveredField = null; render(); }
}
```

Add overlay CSS to the `<style>` block:
```css
:global(.mh-cell.mh-ovr), :global(.mh-char.mh-ovr) {
  background: var(--mint-pale);
}
:global(.mh-cell.mh-ovr:hover), :global(.mh-char.mh-ovr:hover) {
  background: var(--mint); cursor: help;
}
:global(.mh-cell.mh-hot), :global(.mh-char.mh-hot) {
  background: var(--mint);
}
```

- [ ] **Step 4: Commit**

```bash
git add web/v1/js/modules/minihex.js web/v1/css/game.css web/v2/src/lib/MiniHex.svelte
git commit -m "minihex: add GBA header overlays, field hover detail, binary in byte info"
```

---

### Task 4: Demo landmarks in GAME pane

**Files:**
- Modify: `web/v1/js/modules/game.js`
- Modify: `web/v2/src/lib/Game.svelte`
- Modify: `web/v1/css/game.css`

Add a row of landmark buttons between the controls and the ROM inspector. Each button jumps both MiniHex and main HEX to a known interesting address. GBA carts have predictable structure, so we can auto-detect these on load.

- [ ] **Step 1: Add landmark detection helper to v1 game.js**

Add after the `cartMetaText` function (after line 29):
```javascript
function detectLandmarks(bytes) {
  const marks = [];
  if (bytes.byteLength < 0xC0) return marks;
  // Decode the ARM branch at 0x00 to find the real entry point
  const branchWord = (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
  // ARM branch: top 8 bits = 0xEA, bottom 24 bits = signed offset in words
  if ((branchWord >>> 24) === 0xEA) {
    let offset24 = branchWord & 0x00FFFFFF;
    if (offset24 & 0x800000) offset24 |= 0xFF000000; // sign extend
    // PC is at branch_addr + 8 (pipeline), target = PC + offset*4
    const target = (0x00 + 8 + (offset24 << 2)) >>> 0;
    if (target < bytes.byteLength && target > 0xC0) {
      marks.push({ off: target, label: 'ENTRY', desc: 'Code entry point (from branch at 0x00)' });
    }
  }
  marks.push({ off: 0x00, label: 'BRANCH', desc: 'ARM branch instruction' });
  marks.push({ off: 0x04, label: 'LOGO', desc: 'Nintendo logo bitmap (156 bytes)' });
  marks.push({ off: 0xA0, label: 'HEADER', desc: 'Cartridge header (title, code, checksum)' });
  marks.push({ off: 0xC0, label: 'POST-HDR', desc: 'First byte after the header' });
  // Sort: ENTRY first if it exists, then by offset
  marks.sort((a, b) => {
    if (a.label === 'ENTRY') return -1;
    if (b.label === 'ENTRY') return 1;
    return a.off - b.off;
  });
  return marks;
}
```

- [ ] **Step 2: Add landmark bar DOM to v1 game.js**

After the controls div is created (~line 70), add a landmarks container:
```javascript
const landmarksHost = el('div', { class: 'g-landmarks' });
const landmarksTitle = el('span', { class: 'g-landmarks-title', text: 'LANDMARKS' });
```

Insert `landmarksHost` into `gLeft` (modify the gLeft children, ~line 71):
```javascript
const gLeft = el('div', { class: 'g-left' }, [canvasWrap, controls, landmarksHost]);
```

Add a `renderLandmarks` function:
```javascript
function renderLandmarks() {
  if (!currentBytes) {
    replaceChildren(landmarksHost, []);
    return;
  }
  const marks = detectLandmarks(currentBytes);
  const buttons = marks.map(m => {
    const b = el('button', {
      class: 'g-lm-btn', type: 'button',
      title: m.desc,
    }, [
      el('span', { class: 'g-lm-label', text: m.label }),
      el('span', { class: 'g-lm-off', text: hex8(m.off) }),
    ]);
    b.addEventListener('click', () => {
      miniHex.jumpTo(m.off);
      gotoIn('hex', m.off, m.label === 'ENTRY' ? 4 : 1);
    });
    return b;
  });
  replaceChildren(landmarksHost, [landmarksTitle, ...buttons]);
}
```

Call `renderLandmarks()` in `gameFileSub` after `miniHex.setBytes(bytes)` (~line 347):
```javascript
renderLandmarks();
```

And in the null-bytes branch of gameFileSub, clear landmarks:
```javascript
renderLandmarks();
```

- [ ] **Step 3: Add landmark CSS to v1 game.css**

Append before the MiniHex section:
```css
/* ─── Landmarks ──────────────────────────────── */
.g-landmarks {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 0 0;
  flex-wrap: wrap;
}
.g-landmarks:empty { display: none; }
.g-landmarks-title {
  font-size: 8px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
  margin-right: 4px;
}
.g-lm-btn {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: inherit;
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mint-deep);
  background: transparent;
  border: 1px solid var(--rule);
  padding: 4px 10px;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.g-lm-btn:hover {
  background: var(--mint-pale);
  border-color: var(--mint-deep);
}
.g-lm-label { font-weight: 600; }
.g-lm-off { color: var(--muted); font-size: 8px; }
```

- [ ] **Step 4: Add landmarks to v2 Game.svelte**

Add `detectLandmarks` function in the script section (after `fmtBytes`, ~line 45):
```javascript
function detectLandmarks(b) {
  const marks = [];
  if (!b || b.byteLength < 0xC0) return marks;
  const branchWord = (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
  if ((branchWord >>> 24) === 0xEA) {
    let offset24 = branchWord & 0x00FFFFFF;
    if (offset24 & 0x800000) offset24 |= 0xFF000000;
    const target = (0x00 + 8 + (offset24 << 2)) >>> 0;
    if (target < b.byteLength && target > 0xC0) {
      marks.push({ off: target, label: 'ENTRY', desc: 'Code entry point (from branch at 0x00)' });
    }
  }
  marks.push({ off: 0x00, label: 'BRANCH', desc: 'ARM branch instruction' });
  marks.push({ off: 0x04, label: 'LOGO', desc: 'Nintendo logo bitmap (156 bytes)' });
  marks.push({ off: 0xA0, label: 'HEADER', desc: 'Cartridge header (title, code, checksum)' });
  marks.push({ off: 0xC0, label: 'POST-HDR', desc: 'First byte after the header' });
  marks.sort((a, b) => {
    if (a.label === 'ENTRY') return -1;
    if (b.label === 'ENTRY') return 1;
    return a.off - b.off;
  });
  return marks;
}
```

Add a derived state:
```javascript
let landmarks = $derived(detectLandmarks(bytes));
```

Add landmark bar markup in the template, after `</div><!-- .g-controls -->` and before `</div><!-- .g-left -->`:
```svelte
{#if landmarks.length}
  <div class="g-landmarks">
    <span class="g-landmarks-title">LANDMARKS</span>
    {#each landmarks as m}
      <button class="g-lm-btn" type="button" title={m.desc}
        onclick={() => { cursor = m.off; }}>
        <span class="g-lm-label">{m.label}</span>
        <span class="g-lm-off">{hex8(m.off)}</span>
      </button>
    {/each}
  </div>
{/if}
```

Add landmark CSS to v2 Game.svelte's `<style>` block (same CSS as v1):
```css
.g-landmarks {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 0 0;
  flex-wrap: wrap;
}
.g-landmarks-title {
  font-size: 8px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
  margin-right: 4px;
}
.g-lm-btn {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: inherit;
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mint-deep);
  background: transparent;
  border: 1px solid var(--rule);
  padding: 4px 10px;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.g-lm-btn:hover {
  background: var(--mint-pale);
  border-color: var(--mint-deep);
}
.g-lm-label { font-weight: 600; }
.g-lm-off { color: var(--muted); font-size: 8px; }
```

- [ ] **Step 5: Commit**

```bash
git add web/v1/js/modules/game.js web/v1/css/game.css web/v2/src/lib/Game.svelte
git commit -m "game: add demo landmarks bar for quick jumps to entry, header, logo"
```

---

### Task 5: V2 HEX — virtual scrolling (replace pagination)

**Files:**
- Modify: `web/v2/src/lib/Hex.svelte`

This is the biggest single change. Replace the `offset + PAGE` pagination model with a capped-sizer + absolute-positioned row pool, matching v1's approach. The scroll container gets a tall sizer div; rows are rendered into a pool and positioned by computed `top` px.

- [ ] **Step 1: Replace pagination state with virtual scroll state**

In `web/v2/src/lib/Hex.svelte`, replace the state variables at the top of the script:

Remove these lines:
```javascript
let offset = $state(0);
const PAGE = 16 * 32;
let rows = $state([]);
```

Add these in their place:
```javascript
const ROW_HEIGHT = 20;
const BYTES_PER_ROW = 16;
const OVERSCAN = 6;
const MAX_PHYSICAL_PX = 2_000_000;
```

Add new state variables:
```javascript
let scrollEl = $state(null);
let sizerEl = $state(null);
let viewportHeight = $state(400);
let scrollTop = $state(0);
let rowPool = [];
let geom = { physicalPx: 0, scale: 1 };
```

- [ ] **Step 2: Add virtualization helpers**

Add these functions (matching v1's virtualize.js):
```javascript
function virtualGeometry(totalRows) {
  const naturalPx = Math.max(0, totalRows * ROW_HEIGHT);
  if (naturalPx <= MAX_PHYSICAL_PX) return { physicalPx: naturalPx, scale: 1 };
  return { physicalPx: MAX_PHYSICAL_PX, scale: naturalPx / MAX_PHYSICAL_PX };
}

function visibleRange() {
  const totalRows = Math.ceil((bytes?.length ?? 0) / BYTES_PER_ROW);
  if (totalRows === 0) return { start: 0, end: 0, topPx: 0 };
  const s = geom.scale;
  const virtualScrollTop = scrollTop * s;
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const rawStart = Math.floor(virtualScrollTop / ROW_HEIGHT) - OVERSCAN;
  const start = Math.max(0, rawStart);
  const end = Math.min(totalRows, start + visibleCount);
  let topPx;
  if (s === 1) {
    topPx = start * ROW_HEIGHT;
  } else {
    const remainder = virtualScrollTop - start * ROW_HEIGHT;
    topPx = scrollTop - remainder / s;
  }
  return { start, end, topPx };
}
```

- [ ] **Step 3: Replace buildRows + render with DOM-based row pool**

Remove the old `buildRows()` and `render()` functions. Replace with:
```javascript
function ensurePool(n) {
  while (rowPool.length < n) {
    const r = document.createElement('div');
    r.className = 'hex-row';
    r.style.position = 'absolute';
    r.style.left = '0';
    r.style.right = '0';
    r.style.height = `${ROW_HEIGHT}px`;
    rowPool.push(r);
  }
}

function buildRowHTML(rowIdx) {
  const ov = activeOverlay();
  const startByte = rowIdx * BYTES_PER_ROW;
  const endByte = Math.min(bytes.length, startByte + BYTES_PER_ROW);

  const addr = document.createElement('span');
  addr.className = 'addr';
  addr.textContent = hex8(startByte);

  const bytesSpan = document.createElement('span');
  bytesSpan.className = 'bytes';
  const asciiSpan = document.createElement('span');
  asciiSpan.className = 'ascii';

  for (let i = startByte; i < endByte; i++) {
    const v = bytes[i];
    const f = fieldAt(i);

    const byteEl = document.createElement('button');
    byteEl.type = 'button';
    byteEl.className = 'byte';
    if (f) byteEl.classList.add('ovr');
    if (hoveredField && f === hoveredField) byteEl.classList.add('hot');
    if (selectedOffset === i) byteEl.classList.add('sel');
    byteEl.dataset.fi = String(i);
    byteEl.textContent = hex2(v);

    const charEl = document.createElement('button');
    charEl.type = 'button';
    charEl.className = 'char';
    if (f) charEl.classList.add('ovr');
    if (hoveredField && f === hoveredField) charEl.classList.add('hot');
    if (selectedOffset === i) charEl.classList.add('sel');
    charEl.dataset.fi = String(i);
    charEl.textContent = asciiCh(v);

    bytesSpan.appendChild(byteEl);
    asciiSpan.appendChild(charEl);

    if (i - startByte === 7) {
      const mid = document.createElement('span');
      mid.className = 'wide';
      mid.textContent = ' ';
      bytesSpan.appendChild(mid);
      const amid = document.createElement('span');
      amid.className = 'wide';
      asciiSpan.appendChild(amid);
    }
    if (i < endByte - 1) {
      bytesSpan.appendChild(document.createTextNode(' '));
    }
  }
  return [addr, bytesSpan, asciiSpan];
}

function render() {
  if (!bytes || !sizerEl) return;
  const totalRows = Math.ceil(bytes.length / BYTES_PER_ROW);
  geom = virtualGeometry(totalRows);
  sizerEl.style.height = `${geom.physicalPx}px`;

  const range = visibleRange();
  const count = range.end - range.start;
  ensurePool(count);

  for (let i = count; i < rowPool.length; i++) {
    if (rowPool[i].parentNode) rowPool[i].remove();
  }

  for (let i = 0; i < count; i++) {
    const rowIdx = range.start + i;
    const node = rowPool[i];
    node.style.top = `${range.topPx + i * ROW_HEIGHT}px`;
    node.dataset.row = String(rowIdx);
    node.dataset.rowOff = String(rowIdx * BYTES_PER_ROW);
    node.replaceChildren(...buildRowHTML(rowIdx));
    if (node.parentNode !== sizerEl) sizerEl.appendChild(node);
  }
  updateEntropyMarker();
}
```

- [ ] **Step 4: Replace navigation controls**

Remove the old `move()` function. Replace with keyboard nav and updated scrollToOffset:
```javascript
function scrollToOffset(o, flash = true) {
  if (!bytes || !bytes.length || !scrollEl) return;
  const clamped = Math.max(0, Math.min(bytes.length - 1, Number(o) | 0));
  const targetRow = Math.floor(clamped / BYTES_PER_ROW);
  const thirdOffset = Math.max(0, Math.floor(viewportHeight / 3));
  const virtualTargetTop = targetRow * ROW_HEIGHT;
  const top = Math.max(0, (virtualTargetTop - thirdOffset) / (geom.scale || 1));
  try {
    scrollEl.scrollTo({ top, behavior: 'smooth' });
  } catch (_) {
    scrollEl.scrollTop = top;
  }
  if (flash) {
    flashOffset = targetRow * BYTES_PER_ROW;
    flashUntil = performance.now() + FLASH_MS;
    flashTick++;
    requestAnimationFrame(() => requestAnimationFrame(doFlash));
  }
}

function doFlash() {
  if (flashOffset == null) return;
  const startRow = Math.floor(flashOffset / BYTES_PER_ROW);
  rowPool.forEach(node => {
    const r = Number(node.dataset.row);
    if (r === startRow) {
      node.classList.remove('flash');
      void node.offsetWidth;
      node.classList.add('flash');
      setTimeout(() => node.classList.remove('flash'), 480);
    }
  });
  // Cell-level flash
  const endByte = flashOffset + BYTES_PER_ROW;
  const cells = sizerEl.querySelectorAll('[data-fi]');
  cells.forEach(cell => {
    const fi = Number(cell.dataset.fi);
    if (fi >= flashOffset && fi < endByte) {
      cell.classList.remove('flash');
      void cell.offsetWidth;
      cell.classList.add('flash');
      setTimeout(() => cell.classList.remove('flash'), 480);
    }
  });
}

function onKeydown(e) {
  if (!bytes?.length) return;
  const page = Math.max(1, Math.floor(viewportHeight / ROW_HEIGHT) - 2);
  const stepRow = (rows) => {
    const virtualY = scrollTop * (geom.scale || 1);
    const newVirtualY = Math.max(0, virtualY + rows * ROW_HEIGHT);
    scrollEl.scrollTop = newVirtualY / (geom.scale || 1);
  };
  if (e.key === 'PageDown') { e.preventDefault(); stepRow(page); }
  else if (e.key === 'PageUp') { e.preventDefault(); stepRow(-page); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); stepRow(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); stepRow(-1); }
  else if (e.key === 'Home') { e.preventDefault(); scrollEl.scrollTop = 0; }
  else if (e.key === 'End') { e.preventDefault(); scrollEl.scrollTop = geom.physicalPx; }
}
```

Add an entropy marker updater:
```javascript
function updateEntropyMarker() {
  // viewportFrac is used by the entropy strip cursor
  if (bytes && bytes.length) {
    const virtualY = scrollTop * (geom.scale || 1);
    const firstByte = Math.floor(virtualY / ROW_HEIGHT) * BYTES_PER_ROW;
    viewportFrac = Math.max(0, Math.min(1, firstByte / Math.max(1, bytes.length)));
  } else {
    viewportFrac = 0;
  }
}
```

Change `viewportFrac` from `$derived` to `$state`:
```javascript
// was: let viewportFrac = $derived(...)
let viewportFrac = $state(0);
```

- [ ] **Step 5: Replace the template grid section**

Replace the entire `.grid` div and its contents with:
```svelte
<div class="grid" bind:this={scrollEl} tabindex="0"
  onkeydown={onKeydown}
  onclick={onGridClick}
  onmouseover={onGridHover}
  onmouseleave={onGridLeave}>
  <div class="sizer" bind:this={sizerEl}></div>
</div>
```

Remove the old `hoveredRow` template bindings. Add event handler functions:
```javascript
function onGridClick(e) {
  const t = e.target.closest('[data-fi]');
  if (!t) return;
  selectedOffset = Number(t.dataset.fi);
  render();
}

function onGridHover(e) {
  const t = e.target.closest('.ovr');
  if (!t) return;
  const fi = Number(t.dataset.fi);
  const f = fieldAt(fi);
  if (f && f !== hoveredField) {
    hoveredField = f;
    render();
  }
}

function onGridLeave() {
  if (hoveredField) { hoveredField = null; render(); }
}
```

- [ ] **Step 6: Wire up scroll + resize observers**

Replace the old `$effect` blocks for bytes/format changes. Add mount logic:
```javascript
import { onMount, onDestroy } from 'svelte';

let scrollRaf = 0;
let ro;

onMount(() => {
  ro = new ResizeObserver(() => {
    viewportHeight = scrollEl.clientHeight;
    render();
  });
  ro.observe(scrollEl);
  scrollEl.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      scrollTop = scrollEl.scrollTop;
      render();
    });
  }, { passive: true });
  render();
});
onDestroy(() => { try { ro?.disconnect(); } catch (_) {} });
```

Update the bytes/format change effects:
```javascript
$effect(() => {
  const b = bytes;
  if (scrollEl) scrollEl.scrollTop = 0;
  scrollTop = 0;
  selectedOffset = null;
  hoveredField = null;
  if (core) {
    blockSize = Math.max(64, Math.ceil((b?.length ?? 0) / 256));
    entropy = b ? core.entropy_blocks(b, blockSize) : [];
  }
  render();
});
```

- [ ] **Step 7: Update CSS for absolute-positioned rows**

In the `<style>` block, update `.grid` and `.hex-row`:
```css
.grid {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  border: 1px solid var(--rule);
  background: var(--paper);
  padding: 8px 0;
  font-size: 11px;
  line-height: 20px;
  font-family: var(--mono);
  position: relative;
}
.grid:focus { outline: 2px solid var(--mint-deep); outline-offset: -2px; }
.sizer { position: relative; width: 100%; }
```

Remove the `.hex-row.hover` rule (no longer needed since hover is via CSS `:hover`). Add:
```css
.hex-row:hover { background: var(--tint-row); }
```

Add the dual flash CSS (matching v1):
```css
.hex-row.flash {
  background: var(--tint-drop);
  transition: background 400ms ease;
}
@keyframes hex-cell-flash {
  from { background: var(--tint-drop); }
  to   { background: transparent; }
}
.byte.flash, .char.flash {
  animation: hex-cell-flash 400ms ease forwards;
}
```

Remove the old `--flash-a` / `color-mix` rules.

- [ ] **Step 8: Remove the old PAGE/ROW navigation buttons from the template**

Replace the bar's control section. Remove the PAGE/ROW buttons since keyboard nav + GOTO now handle navigation:
```svelte
<div class="bar">
  <span class="ti">[ HEX ]</span>
  <div class="ctl">
    <form class="goto" onsubmit={gotoOffset}>
      <span class="at">GOTO</span>
      <input
        type="text"
        bind:value={gotoVal}
        placeholder="0x00000000"
        aria-label="Jump to hex offset"
      />
    </form>
  </div>
</div>
```

Remove the button CSS rules from the style block (the `.ctl button` styles).

- [ ] **Step 9: Add binary representation to byte detail**

Update `byteDetail()`:
```javascript
function byteDetail() {
  if (!bytes || selectedOffset == null || selectedOffset < 0 || selectedOffset >= bytes.length) return null;
  const v = bytes[selectedOffset];
  const bin = v.toString(2).padStart(8, '0');
  const u16 = selectedOffset + 1 < bytes.length ? (bytes[selectedOffset] | (bytes[selectedOffset + 1] << 8)) : null;
  const u32 = selectedOffset + 3 < bytes.length
    ? ((bytes[selectedOffset] | (bytes[selectedOffset + 1] << 8) | (bytes[selectedOffset + 2] << 16) | (bytes[selectedOffset + 3] << 24)) >>> 0)
    : null;
  const parts = [`OFF ${hex8(selectedOffset)}`, `BYTE 0x${hex2(v)} (${v})`, `b${bin}`, `ASCII '${asciiCh(v)}'`];
  if (u16 !== null) parts.push(`U16LE 0x${u16.toString(16).toUpperCase().padStart(4, '0')}`);
  if (u32 !== null) parts.push(`U32LE 0x${u32.toString(16).toUpperCase().padStart(8, '0')}`);
  return parts.join(' \u00B7 ');
}
```

- [ ] **Step 10: Add entropy block tooltips**

Update the entropy strip template to include title attributes:
```svelte
{#each entropy as e, i}
  <span class="strip-col"
    style="height: {Math.max(2, e * 100)}%; opacity: {0.35 + e * 0.65}"
    title="block {i} \u00B7 offset 0x{(Math.floor(i * (bytes?.length ?? 0) / entropy.length)).toString(16).toUpperCase()} \u00B7 entropy {e.toFixed(1)} bits"
  ></span>
{/each}
```

- [ ] **Step 11: Verify follow target still works**

The `followTarget` effect needs to use the new `scrollToOffset`:
```javascript
let lastFollowRow = -1;
$effect(() => {
  const f = followTarget;
  if (!f || typeof f.offset !== 'number') {
    lastFollowRow = -1;
    return;
  }
  const row = Math.floor(f.offset / BYTES_PER_ROW);
  if (row === lastFollowRow) return;
  lastFollowRow = row;
  scrollToOffset(f.offset, false);
});
```

This already works since `scrollToOffset` was updated. No change needed.

- [ ] **Step 12: Commit**

```bash
git add web/v2/src/lib/Hex.svelte
git commit -m "v2 hex: replace pagination with virtual scrolling, add keyboard nav, dual flash, binary detail, entropy tooltips"
```

---

### Task 6: Build + deploy

**Files:**
- None (build artifacts)

- [ ] **Step 1: Run build**

```bash
cd ~/dev/scry && bash scripts/build.sh
```

Expected: successful build of v1 (minified) and v2 (Vite/Svelte).

- [ ] **Step 2: Smoke test locally**

Open `web/dist/v1/index.html` and `web/dist/v2/index.html` in a browser. Load the demo Pokemon Emerald GBA cart. Verify:
- Follow is ON by default
- Landmarks bar appears with ENTRY/BRANCH/LOGO/HEADER/POST-HDR
- Clicking landmarks jumps MiniHex and HEX
- MiniHex shows colored overlay bytes in header region
- Hovering overlay bytes in MiniHex shows field name in detail bar
- V2 HEX scrolls smoothly with virtual scrolling
- PgUp/PgDn/Home/End work in V2 HEX
- PC cursor pulses when emulator is running
- Entropy bar columns glow on hover (v1) / show tooltips (v2)
- Byte selection has pop animation
- Nothing crashes on a 16 MiB cart

- [ ] **Step 3: Deploy**

```bash
cd ~/dev/scry && bash scripts/deploy.sh
```

- [ ] **Step 4: Final commit of any remaining changes**

```bash
git status
# if anything remains, stage and commit
```
