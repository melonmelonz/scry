# Scry — Plan 1 · Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the app shell, design system, file intake, and a working virtualized Hex viewer with struct-overlay support — deployed to `goolz.org/scry`. No Rust yet. This plan ends with a usable hex viewer for any file.

**Architecture:** Vite + Svelte 5 (runes) + TypeScript. CSS variables for the locked design tokens. Hash router for module navigation. Drag-drop + file-picker intake. Virtualized hex rendering with row recycling. Pure JS; the Rust→WASM core arrives in Plan 2 (Inspect).

**Tech Stack:** Vite 6, Svelte 5, TypeScript 5, Vitest (unit tests), fflate (zip parsing — staged here, used in Plan 5), JetBrains Mono via Google Fonts.

**Scope cut from spec §6.1, §6.3, §10 (Days 1-2):**
- App shell (header, tabs, file rail, status bar)
- Design system (tokens, base, components)
- File intake (drop + picker) and magic-byte format detection
- Hash router and module registry
- Hex module: virtualized scroll, 16-byte rows, ASCII gutter, address jump, struct overlay engine, ELF header overlay schema
- Build + deploy scripts; first deploy to `goolz.org/scry`

**Out of scope (later plans):**
- ELF parsing, Inspect view → **Plan 2**
- Disassembly → **Plan 3**
- Emulator → **Plan 4**
- Trace + decoders → **Plan 5**
- Bus bridge and demo wiring → **Plan 6**

---

## File Structure

Files created in this plan:

```
scry/
  web/
    package.json
    tsconfig.json
    vite.config.ts
    vitest.config.ts
    index.html
    src/
      main.ts                                 # Svelte mount
      App.svelte                              # shell composition
      app.d.ts                                # ambient types
      lib/
        design/
          tokens.css                          # palette, typography vars
          base.css                            # reset + body + global rules
          components.css                      # shared chrome (header, tabs, rail, status, rows)
        stores/
          file.svelte.ts                      # current file: name, size, bytes
          router.svelte.ts                    # current route + history sync
        format/
          detect.ts                           # magic-byte → format kind
          detect.test.ts
        hex/
          virtualize.ts                       # visible-range math (pure)
          virtualize.test.ts
          overlays.ts                         # overlay type + ELF header schema
          overlays.test.ts
      shell/
        Header.svelte                         # top bar with brand and meta
        TabBar.svelte                         # module tabs
        FileRail.svelte                       # left rail with file context
        StatusBar.svelte                      # bottom status line
      modules/
        empty/
          Empty.svelte                        # drop zone landing
        hex/
          Hex.svelte                          # virtualized hex viewer
          HexRow.svelte                       # single 16-byte row
          OverlayTip.svelte                   # hover tooltip
  scripts/
    build.sh                                  # builds web/dist
    deploy.sh                                 # rsync to ~/dev/goolz/scry + commit + push
```

Files modified in this plan: none (greenfield).

---

## Task 1: Scaffold the web app

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/vitest.config.ts`, `web/index.html`, `web/src/main.ts`, `web/src/App.svelte`, `web/src/app.d.ts`

- [ ] **Step 1: Initialize the project**

Run:
```bash
cd ~/dev/scry
mkdir -p web && cd web
npm init -y
npm install --save-dev vite @sveltejs/vite-plugin-svelte svelte@^5 typescript svelte-check vitest @vitest/coverage-v8 jsdom @testing-library/svelte
```

Expected: `node_modules/` populated, `package.json` updated.

- [ ] **Step 2: Write `web/package.json`**

```json
{
  "name": "scry-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-check --tsconfig ./tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^5.0.0",
    "@testing-library/svelte": "^5.2.0",
    "@vitest/coverage-v8": "^2.1.0",
    "jsdom": "^25.0.0",
    "svelte": "^5.0.0",
    "svelte-check": "^4.0.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Write `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "allowSyntheticDefaultImports": true,
    "types": ["svelte", "vite/client"]
  },
  "include": ["src/**/*", "src/**/*.svelte"]
}
```

- [ ] **Step 4: Write `web/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: '/scry/',
  plugins: [svelte()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022'
  }
});
```

- [ ] **Step 5: Write `web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ hot: false })],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts']
  }
});
```

- [ ] **Step 6: Write `web/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Scry — Workbench</title>
<meta name="description" content="Scry takes a binary and shows you what it would do, without leaving your browser tab.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
<div id="app"></div>
<script type="module" src="/src/main.ts"></script>
</body>
</html>
```

- [ ] **Step 7: Write `web/src/main.ts`**

```ts
import { mount } from 'svelte';
import App from './App.svelte';
import './lib/design/tokens.css';
import './lib/design/base.css';
import './lib/design/components.css';

const app = mount(App, { target: document.getElementById('app')! });
export default app;
```

- [ ] **Step 8: Write `web/src/app.d.ts`**

```ts
/// <reference types="svelte" />
/// <reference types="vite/client" />
```

- [ ] **Step 9: Write a placeholder `web/src/App.svelte`**

```svelte
<script lang="ts">
  // Placeholder until Task 4 fills in the shell.
</script>

<div class="bootstrap-check">
  <p>scry boot ok</p>
</div>

<style>
  .bootstrap-check { padding: 2rem; font-family: 'JetBrains Mono', monospace; }
</style>
```

- [ ] **Step 10: Verify the dev server starts**

Run:
```bash
cd ~/dev/scry/web && npm run dev
```

Expected: Vite reports `Local: http://localhost:5173/scry/`. Visiting that URL in a browser shows "scry boot ok". Stop the server with Ctrl-C.

- [ ] **Step 11: Commit**

```bash
cd ~/dev/scry
git add web/
git commit -m "web: scaffold Vite + Svelte 5 + TS project"
```

---

## Task 2: Design tokens

**Files:**
- Create: `web/src/lib/design/tokens.css`

- [ ] **Step 1: Write `web/src/lib/design/tokens.css`**

Values lifted directly from spec §3.

```css
:root {
  /* palette */
  --bg:        #F2F1EC;
  --paper:     #FAF8F2;
  --grey:      #DEDDD7;
  --rule:      #C7C5BF;
  --ink:       #1F2421;
  --muted:     #8A8E87;
  --mint:      #A6C9B5;
  --mint-deep: #5E957A;
  --mint-pale: #E2EEE7;

  /* type */
  --mono: 'JetBrains Mono', 'SFMono-Regular', Menlo, monospace;

  /* sizes (px) */
  --fs-label:    9px;
  --fs-chrome:   10px;
  --fs-chrome-2: 11px;
  --fs-body:     12px;
  --fs-body-2:   13px;
  --fs-h4:       14px;
  --fs-h3:       16px;
  --fs-h2:       22px;
  --fs-display:  32px;

  /* tracking for labels */
  --tr-label: 0.16em;
  --tr-bracket: 0.14em;

  /* spacing scale (px) */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 22px;
  --sp-6: 28px;
  --sp-7: 40px;
  --sp-8: 56px;

  /* radii */
  --r-1: 3px;
  --r-2: 4px;
  --r-3: 6px;

  /* rules */
  --r-thin: 1px solid var(--grey);
  --r-strong: 1px solid var(--ink);

  /* motion */
  --t-fast: 120ms ease;
  --t-base: 200ms ease;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/design/tokens.css
git commit -m "design: palette + typography + spacing tokens"
```

---

## Task 3: Base CSS and the mint stripe

**Files:**
- Create: `web/src/lib/design/base.css`

- [ ] **Step 1: Write `web/src/lib/design/base.css`**

```css
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  height: 100%;
}

body {
  font-family: var(--mono);
  background: var(--bg);
  color: var(--ink);
  font-size: var(--fs-body);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  overflow: hidden;
}

/* The mint stripe. Spec §3 — 3px, top, every page. */
body::before {
  content: '';
  position: fixed;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: var(--mint-deep);
  z-index: 100;
  pointer-events: none;
}

button, input, select, textarea {
  font: inherit;
  color: inherit;
}

button {
  background: none;
  border: 0;
  cursor: pointer;
}

a { color: var(--mint-deep); text-decoration: none; }
a:hover { text-decoration: underline; }
```

- [ ] **Step 2: Verify the stripe renders**

Run `npm run dev` and visit `http://localhost:5173/scry/`. Expected: 3px mint line across the top of the viewport, off-white body background, JetBrains Mono on the "scry boot ok" text. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/design/base.css
git commit -m "design: base reset + body + mint stripe"
```

---

## Task 4: Shared component CSS

**Files:**
- Create: `web/src/lib/design/components.css`

- [ ] **Step 1: Write `web/src/lib/design/components.css`**

Captures all shared chrome from the spec §3 + scope-doc wireframes.

```css
/* ─── App frame ────────────────────────────── */
.app {
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  height: 100%;
}

/* ─── Header ───────────────────────────────── */
.s-header {
  padding: 14px 22px 12px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: var(--r-strong);
}
.s-brand {
  font-weight: 600;
  font-size: var(--fs-body-2);
  letter-spacing: 0.04em;
}
.s-brand::before {
  content: '◆ ';
  color: var(--mint-deep);
  font-size: var(--fs-chrome-2);
}
.s-meta {
  display: flex;
  gap: var(--sp-5);
  color: var(--muted);
  font-size: var(--fs-chrome);
  letter-spacing: 0.12em;
}
.s-meta .v { color: var(--ink); margin-left: var(--sp-1); }

/* ─── Tab bar ──────────────────────────────── */
.s-tabs { display: flex; border-bottom: var(--r-thin); }
.s-tabs button {
  padding: 11px 18px;
  font-size: var(--fs-chrome);
  letter-spacing: var(--tr-label);
  text-transform: uppercase;
  color: var(--muted);
  border-right: var(--r-thin);
  transition: color var(--t-fast);
}
.s-tabs button:hover { color: var(--ink); }
.s-tabs button.on {
  color: var(--ink);
  border-bottom: 2px solid var(--mint-deep);
  margin-bottom: -1px;
  background: var(--paper);
}
.s-tabs button:disabled {
  color: var(--rule);
  cursor: not-allowed;
}

/* ─── Body grid (rail + main) ──────────────── */
.s-body {
  display: grid;
  grid-template-columns: 220px 1fr;
  min-height: 0;
  overflow: hidden;
}
.s-rail {
  border-right: var(--r-thin);
  padding: 18px 16px;
  background: rgba(166, 201, 181, 0.05);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.s-rail .row { display: flex; flex-direction: column; gap: 2px; }
.s-rail .row .l {
  font-size: var(--fs-label);
  letter-spacing: var(--tr-bracket);
  color: var(--muted);
  text-transform: uppercase;
}
.s-rail .row .v {
  font-size: var(--fs-chrome-2);
  color: var(--ink);
}
.s-rail .row .v .mint { color: var(--mint-deep); }

.s-main {
  overflow: auto;
  position: relative;
}

/* ─── Status bar ───────────────────────────── */
.s-status {
  padding: 9px 22px;
  display: flex;
  justify-content: space-between;
  border-top: var(--r-thin);
  font-size: var(--fs-label);
  color: var(--muted);
  letter-spacing: 0.12em;
}
.s-status .dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  background: var(--mint-deep);
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: 1px;
}

/* ─── Empty / drop zone ────────────────────── */
.s-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 56px;
}
.s-empty .zone {
  border: 1px dashed var(--rule);
  border-radius: var(--r-3);
  padding: 80px 64px;
  text-align: center;
  background: rgba(166, 201, 181, 0.04);
  max-width: 640px;
  transition: border-color var(--t-base), background var(--t-base);
}
.s-empty .zone.over {
  border-color: var(--mint-deep);
  background: var(--mint-pale);
}
.s-empty h2 {
  font-size: var(--fs-h2);
  font-weight: 400;
  margin-bottom: 12px;
  letter-spacing: -0.01em;
}
.s-empty p.subtitle {
  font-size: var(--fs-chrome-2);
  color: var(--muted);
  letter-spacing: 0.06em;
}
.s-empty button.pick {
  margin-top: 28px;
  font-size: var(--fs-chrome);
  letter-spacing: var(--tr-label);
  text-transform: uppercase;
  padding: 10px 18px;
  border: 1px solid var(--mint-deep);
  color: var(--mint-deep);
  background: var(--paper);
  border-radius: var(--r-1);
  transition: background var(--t-fast);
}
.s-empty button.pick:hover { background: var(--mint-pale); }
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/design/components.css
git commit -m "design: shared chrome - header, tabs, rail, status, drop zone"
```

---

## Task 5: File store (Svelte 5 runes)

**Files:**
- Create: `web/src/lib/stores/file.svelte.ts`, `web/src/lib/stores/file.test.ts`

- [ ] **Step 1: Write the failing test `web/src/lib/stores/file.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { fileStore } from './file.svelte';

describe('fileStore', () => {
  beforeEach(() => fileStore.clear());

  it('starts empty', () => {
    expect(fileStore.name).toBeNull();
    expect(fileStore.bytes).toBeNull();
    expect(fileStore.size).toBe(0);
  });

  it('loads a file', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    fileStore.load('hello.bin', bytes);
    expect(fileStore.name).toBe('hello.bin');
    expect(fileStore.size).toBe(4);
    expect(fileStore.bytes).toBe(bytes);
  });

  it('clears the file', () => {
    fileStore.load('x', new Uint8Array(2));
    fileStore.clear();
    expect(fileStore.name).toBeNull();
    expect(fileStore.bytes).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/dev/scry/web && npm test`
Expected: FAIL — "Cannot find module './file.svelte'".

- [ ] **Step 3: Write `web/src/lib/stores/file.svelte.ts`**

```ts
class FileStore {
  name = $state<string | null>(null);
  bytes = $state<Uint8Array | null>(null);

  get size(): number {
    return this.bytes?.byteLength ?? 0;
  }

  load(name: string, bytes: Uint8Array): void {
    this.name = name;
    this.bytes = bytes;
  }

  clear(): void {
    this.name = null;
    this.bytes = null;
  }
}

export const fileStore = new FileStore();
```

- [ ] **Step 4: Run tests again, verify they pass**

Run: `npm test`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/stores/file.svelte.ts web/src/lib/stores/file.test.ts
git commit -m "stores: file store - name, bytes, size, load, clear"
```

---

## Task 6: Magic-byte format detector

**Files:**
- Create: `web/src/lib/format/detect.ts`, `web/src/lib/format/detect.test.ts`

- [ ] **Step 1: Write the failing test `web/src/lib/format/detect.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { detectFormat, type FormatKind } from './detect';

const bytes = (...b: number[]) => new Uint8Array(b);

describe('detectFormat', () => {
  it('identifies ELF by 7F 45 4C 46', () => {
    expect(detectFormat(bytes(0x7F, 0x45, 0x4C, 0x46, 0x01, 0x01))).toBe<FormatKind>('elf');
  });

  it('identifies Saleae .sal (zip) by 50 4B 03 04', () => {
    expect(detectFormat(bytes(0x50, 0x4B, 0x03, 0x04))).toBe<FormatKind>('sal');
  });

  it('returns unknown for arbitrary bytes', () => {
    expect(detectFormat(bytes(0x00, 0x01, 0x02, 0x03))).toBe<FormatKind>('unknown');
  });

  it('returns unknown for empty input', () => {
    expect(detectFormat(new Uint8Array(0))).toBe<FormatKind>('unknown');
  });

  it('returns unknown when shorter than magic length', () => {
    expect(detectFormat(bytes(0x7F, 0x45))).toBe<FormatKind>('unknown');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `web/src/lib/format/detect.ts`**

```ts
export type FormatKind = 'elf' | 'sal' | 'unknown';

const ELF_MAGIC = [0x7F, 0x45, 0x4C, 0x46] as const;
const ZIP_MAGIC = [0x50, 0x4B, 0x03, 0x04] as const;

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.byteLength < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

export function detectFormat(bytes: Uint8Array): FormatKind {
  if (startsWith(bytes, ELF_MAGIC)) return 'elf';
  if (startsWith(bytes, ZIP_MAGIC)) return 'sal';
  return 'unknown';
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/format/
git commit -m "format: magic-byte detector for ELF and .sal"
```

---

## Task 7: Hash router

**Files:**
- Create: `web/src/lib/stores/router.svelte.ts`, `web/src/lib/stores/router.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { router, type RouteId } from './router.svelte';

describe('router', () => {
  beforeEach(() => {
    window.location.hash = '';
    router.sync();
  });

  it('defaults to empty when no hash', () => {
    expect(router.route).toBe<RouteId>('empty');
  });

  it('navigates to a known route', () => {
    router.go('hex');
    expect(router.route).toBe<RouteId>('hex');
    expect(window.location.hash).toBe('#/hex');
  });

  it('reads hash on sync', () => {
    window.location.hash = '#/inspect';
    router.sync();
    expect(router.route).toBe<RouteId>('inspect');
  });

  it('falls back to empty for unknown routes', () => {
    window.location.hash = '#/garbage';
    router.sync();
    expect(router.route).toBe<RouteId>('empty');
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `web/src/lib/stores/router.svelte.ts`**

```ts
export type RouteId = 'empty' | 'hex' | 'inspect' | 'disasm' | 'emu' | 'trace';

const VALID: readonly RouteId[] = ['empty', 'hex', 'inspect', 'disasm', 'emu', 'trace'];

function parseHash(hash: string): RouteId {
  const slug = hash.replace(/^#\/?/, '');
  return (VALID as readonly string[]).includes(slug) ? (slug as RouteId) : 'empty';
}

class Router {
  route = $state<RouteId>('empty');

  constructor() {
    if (typeof window !== 'undefined') {
      this.sync();
      window.addEventListener('hashchange', () => this.sync());
    }
  }

  sync(): void {
    this.route = parseHash(window.location.hash);
  }

  go(route: RouteId): void {
    window.location.hash = `#/${route}`;
    this.route = route;
  }
}

export const router = new Router();
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/stores/router.svelte.ts web/src/lib/stores/router.test.ts
git commit -m "stores: hash router with sync and go"
```

---

## Task 8: Header component

**Files:**
- Create: `web/src/shell/Header.svelte`

- [ ] **Step 1: Write `web/src/shell/Header.svelte`**

```svelte
<script lang="ts">
  import { fileStore } from '../lib/stores/file.svelte';
</script>

<header class="s-header">
  <span class="s-brand">scry</span>
  <span class="s-meta">
    {#if fileStore.name}
      <span>FILE<span class="v">{fileStore.name}</span></span>
      <span>SIZE<span class="v">{formatSize(fileStore.size)}</span></span>
    {:else}
      <span>WORKBENCH · v0.1</span>
    {/if}
  </span>
</header>

<script lang="ts" module>
  function formatSize(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  }
</script>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/shell/Header.svelte
git commit -m "shell: Header component with file context meta"
```

---

## Task 9: Tab bar component

**Files:**
- Create: `web/src/shell/TabBar.svelte`

- [ ] **Step 1: Write `web/src/shell/TabBar.svelte`**

```svelte
<script lang="ts">
  import { router, type RouteId } from '../lib/stores/router.svelte';
  import { fileStore } from '../lib/stores/file.svelte';

  type Tab = { id: RouteId; label: string; needsFile: boolean; available: boolean };

  // Plan 1 only enables HEX. Other modules light up as their plans ship.
  const tabs: Tab[] = [
    { id: 'inspect', label: 'INSPECT', needsFile: true, available: false },
    { id: 'hex',     label: 'HEX',     needsFile: true, available: true  },
    { id: 'disasm',  label: 'DISASM',  needsFile: true, available: false },
    { id: 'emu',     label: 'EMU',     needsFile: true, available: false },
    { id: 'trace',   label: 'TRACE',   needsFile: false, available: false }
  ];

  function isDisabled(t: Tab): boolean {
    if (!t.available) return true;
    if (t.needsFile && !fileStore.bytes) return true;
    return false;
  }
</script>

<nav class="s-tabs">
  {#each tabs as t (t.id)}
    <button
      class:on={router.route === t.id}
      disabled={isDisabled(t)}
      onclick={() => router.go(t.id)}
    >{t.label}</button>
  {/each}
</nav>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/shell/TabBar.svelte
git commit -m "shell: TabBar with availability gating"
```

---

## Task 10: File rail component

**Files:**
- Create: `web/src/shell/FileRail.svelte`

- [ ] **Step 1: Write `web/src/shell/FileRail.svelte`**

```svelte
<script lang="ts">
  import { fileStore } from '../lib/stores/file.svelte';
  import { detectFormat } from '../lib/format/detect';

  let format = $derived(fileStore.bytes ? detectFormat(fileStore.bytes) : 'none');

  function sizeFmt(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
  }
</script>

<aside class="s-rail">
  {#if fileStore.bytes}
    <div class="row">
      <span class="l">File</span>
      <span class="v">{fileStore.name}</span>
    </div>
    <div class="row">
      <span class="l">Size</span>
      <span class="v">{sizeFmt(fileStore.size)}</span>
    </div>
    <div class="row">
      <span class="l">Format</span>
      <span class="v">{format === 'elf' ? 'ELF' : format === 'sal' ? 'Saleae capture' : 'raw bytes'}</span>
    </div>
  {:else}
    <div class="row">
      <span class="l">No file loaded</span>
      <span class="v"><span class="mint">·</span> drop or pick to begin</span>
    </div>
  {/if}
</aside>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/shell/FileRail.svelte
git commit -m "shell: FileRail with file context display"
```

---

## Task 11: Status bar component

**Files:**
- Create: `web/src/shell/StatusBar.svelte`

- [ ] **Step 1: Write `web/src/shell/StatusBar.svelte`**

```svelte
<script lang="ts">
  import { router } from '../lib/stores/router.svelte';
  import { fileStore } from '../lib/stores/file.svelte';

  let leftText = $derived(fileStore.bytes ? 'READY · LOCAL · NO UPLOAD' : 'AWAITING FILE · LOCAL · NO UPLOAD');
</script>

<footer class="s-status">
  <span><span class="dot"></span>{leftText}</span>
  <span>MODULE · {router.route.toUpperCase()} · WORKBENCH v0.1</span>
</footer>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/shell/StatusBar.svelte
git commit -m "shell: StatusBar with module + ready state"
```

---

## Task 12: Empty module (drop zone)

**Files:**
- Create: `web/src/modules/empty/Empty.svelte`

- [ ] **Step 1: Write `web/src/modules/empty/Empty.svelte`**

```svelte
<script lang="ts">
  import { fileStore } from '../../lib/stores/file.svelte';

  let dragOver = $state(false);
  let inputEl: HTMLInputElement;

  async function readFile(file: File): Promise<void> {
    const buf = await file.arrayBuffer();
    fileStore.load(file.name, new Uint8Array(buf));
  }

  function onDragOver(e: DragEvent): void {
    e.preventDefault();
    dragOver = true;
  }

  function onDragLeave(): void {
    dragOver = false;
  }

  async function onDrop(e: DragEvent): Promise<void> {
    e.preventDefault();
    dragOver = false;
    const file = e.dataTransfer?.files[0];
    if (file) await readFile(file);
  }

  async function onPick(e: Event): Promise<void> {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) await readFile(file);
  }
</script>

<section
  class="s-empty"
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
>
  <div class="zone" class:over={dragOver}>
    <h2>Drop a binary to begin.</h2>
    <p class="subtitle">ELF · Saleae .sal · raw bytes</p>
    <button class="pick" onclick={() => inputEl.click()}>Choose file</button>
    <input type="file" bind:this={inputEl} onchange={onPick} hidden>
  </div>
</section>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/modules/empty/Empty.svelte
git commit -m "modules: Empty drop-zone with drag + picker"
```

---

## Task 13: Virtualization math (pure)

**Files:**
- Create: `web/src/lib/hex/virtualize.ts`, `web/src/lib/hex/virtualize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { visibleRange } from './virtualize';

describe('visibleRange', () => {
  it('clamps to zero at the top', () => {
    const r = visibleRange({ scrollTop: 0, viewportHeight: 320, rowHeight: 20, totalRows: 1000, overscan: 4 });
    expect(r.start).toBe(0);
    expect(r.end).toBeGreaterThanOrEqual(16);
    expect(r.end).toBeLessThanOrEqual(20);
  });

  it('shifts window when scrolled', () => {
    const r = visibleRange({ scrollTop: 1000, viewportHeight: 320, rowHeight: 20, totalRows: 1000, overscan: 4 });
    expect(r.start).toBe(46); // 1000/20 - 4 overscan
    expect(r.end).toBe(70);   // 46 + (320/20) + 4 + 4
  });

  it('clamps end to totalRows', () => {
    const r = visibleRange({ scrollTop: 19_990, viewportHeight: 320, rowHeight: 20, totalRows: 1000, overscan: 4 });
    expect(r.end).toBe(1000);
  });

  it('handles zero rows', () => {
    const r = visibleRange({ scrollTop: 0, viewportHeight: 320, rowHeight: 20, totalRows: 0, overscan: 4 });
    expect(r.start).toBe(0);
    expect(r.end).toBe(0);
  });

  it('top spacer in pixels equals start * rowHeight', () => {
    const r = visibleRange({ scrollTop: 400, viewportHeight: 320, rowHeight: 20, totalRows: 1000, overscan: 4 });
    expect(r.topPad).toBe(r.start * 20);
  });

  it('bottom spacer equals (totalRows - end) * rowHeight', () => {
    const r = visibleRange({ scrollTop: 400, viewportHeight: 320, rowHeight: 20, totalRows: 1000, overscan: 4 });
    expect(r.bottomPad).toBe((1000 - r.end) * 20);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `web/src/lib/hex/virtualize.ts`**

```ts
export interface VRangeInput {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  totalRows: number;
  overscan: number;
}

export interface VRange {
  start: number;
  end: number;
  topPad: number;
  bottomPad: number;
}

export function visibleRange(i: VRangeInput): VRange {
  if (i.totalRows === 0) {
    return { start: 0, end: 0, topPad: 0, bottomPad: 0 };
  }
  const visibleCount = Math.ceil(i.viewportHeight / i.rowHeight);
  const rawStart = Math.floor(i.scrollTop / i.rowHeight) - i.overscan;
  const start = Math.max(0, rawStart);
  const end = Math.min(i.totalRows, start + visibleCount + i.overscan * 2);
  return {
    start,
    end,
    topPad: start * i.rowHeight,
    bottomPad: (i.totalRows - end) * i.rowHeight
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/hex/virtualize.ts web/src/lib/hex/virtualize.test.ts
git commit -m "hex: pure virtualization math with overscan"
```

---

## Task 14: Overlay schema and ELF header definition

**Files:**
- Create: `web/src/lib/hex/overlays.ts`, `web/src/lib/hex/overlays.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { ELF32_HEADER_OVERLAY, findOverlayAt, decodeField } from './overlays';

describe('overlays', () => {
  it('ELF32 header overlay covers 52 bytes', () => {
    const last = ELF32_HEADER_OVERLAY[ELF32_HEADER_OVERLAY.length - 1];
    expect(last.offset + last.size).toBe(52);
  });

  it('findOverlayAt returns the field covering an offset', () => {
    const f = findOverlayAt(ELF32_HEADER_OVERLAY, 0x12);
    expect(f?.name).toBe('e_machine');
    expect(f?.size).toBe(2);
  });

  it('returns null for offsets outside any overlay', () => {
    expect(findOverlayAt(ELF32_HEADER_OVERLAY, 0xFFFF)).toBeNull();
  });

  it('decodes e_machine as u16 little-endian', () => {
    const bytes = new Uint8Array(52);
    bytes[0x12] = 0xF3;
    bytes[0x13] = 0x00;
    const val = decodeField(bytes, ELF32_HEADER_OVERLAY.find(f => f.name === 'e_machine')!);
    expect(val).toBe(0xF3);
  });

  it('decodes e_ident magic as u32 big-endian (visual hex)', () => {
    const bytes = new Uint8Array(52);
    bytes.set([0x7F, 0x45, 0x4C, 0x46], 0);
    const field = ELF32_HEADER_OVERLAY.find(f => f.name === 'e_ident.magic')!;
    const val = decodeField(bytes, field);
    expect(val).toBe(0x7F454C46);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `web/src/lib/hex/overlays.ts`**

```ts
export type Endian = 'le' | 'be';
export type FieldType = 'u8' | 'u16' | 'u32' | 'bytes' | 'string';

export interface OverlayField {
  offset: number;
  size: number;
  name: string;
  type: FieldType;
  endian?: Endian;
  description?: string;
}

export type OverlaySchema = ReadonlyArray<OverlayField>;

export const ELF32_HEADER_OVERLAY: OverlaySchema = [
  { offset: 0x00, size: 4, name: 'e_ident.magic',     type: 'u32', endian: 'be', description: 'ELF magic (0x7F "ELF")' },
  { offset: 0x04, size: 1, name: 'e_ident.class',     type: 'u8',                description: '1 = 32-bit, 2 = 64-bit' },
  { offset: 0x05, size: 1, name: 'e_ident.data',      type: 'u8',                description: '1 = little-endian, 2 = big-endian' },
  { offset: 0x06, size: 1, name: 'e_ident.version',   type: 'u8' },
  { offset: 0x07, size: 1, name: 'e_ident.osabi',     type: 'u8' },
  { offset: 0x08, size: 1, name: 'e_ident.abiversion',type: 'u8' },
  { offset: 0x09, size: 7, name: 'e_ident.pad',       type: 'bytes' },
  { offset: 0x10, size: 2, name: 'e_type',            type: 'u16', endian: 'le', description: '2 = EXEC, 3 = DYN' },
  { offset: 0x12, size: 2, name: 'e_machine',         type: 'u16', endian: 'le', description: '243 = RISC-V, 62 = x86_64' },
  { offset: 0x14, size: 4, name: 'e_version',         type: 'u32', endian: 'le' },
  { offset: 0x18, size: 4, name: 'e_entry',           type: 'u32', endian: 'le', description: 'Entry-point virtual address' },
  { offset: 0x1C, size: 4, name: 'e_phoff',           type: 'u32', endian: 'le' },
  { offset: 0x20, size: 4, name: 'e_shoff',           type: 'u32', endian: 'le' },
  { offset: 0x24, size: 4, name: 'e_flags',           type: 'u32', endian: 'le' },
  { offset: 0x28, size: 2, name: 'e_ehsize',          type: 'u16', endian: 'le' },
  { offset: 0x2A, size: 2, name: 'e_phentsize',       type: 'u16', endian: 'le' },
  { offset: 0x2C, size: 2, name: 'e_phnum',           type: 'u16', endian: 'le' },
  { offset: 0x2E, size: 2, name: 'e_shentsize',       type: 'u16', endian: 'le' },
  { offset: 0x30, size: 2, name: 'e_shnum',           type: 'u16', endian: 'le' },
  { offset: 0x32, size: 2, name: 'e_shstrndx',        type: 'u16', endian: 'le' }
];

export function findOverlayAt(schema: OverlaySchema, offset: number): OverlayField | null {
  for (const f of schema) {
    if (offset >= f.offset && offset < f.offset + f.size) return f;
  }
  return null;
}

export function decodeField(bytes: Uint8Array, f: OverlayField): number | string {
  if (offset_oob(bytes, f)) return NaN;
  if (f.type === 'u8') return bytes[f.offset];
  if (f.type === 'u16') return readU16(bytes, f.offset, f.endian ?? 'le');
  if (f.type === 'u32') return readU32(bytes, f.offset, f.endian ?? 'le');
  if (f.type === 'string') return new TextDecoder().decode(bytes.subarray(f.offset, f.offset + f.size));
  // 'bytes'
  return Array.from(bytes.subarray(f.offset, f.offset + f.size))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ');
}

function offset_oob(bytes: Uint8Array, f: OverlayField): boolean {
  return f.offset + f.size > bytes.byteLength;
}

function readU16(b: Uint8Array, o: number, e: Endian): number {
  return e === 'le' ? (b[o] | (b[o + 1] << 8)) : ((b[o] << 8) | b[o + 1]);
}

function readU32(b: Uint8Array, o: number, e: Endian): number {
  return e === 'le'
    ? ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0)
    : (((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/hex/overlays.ts web/src/lib/hex/overlays.test.ts
git commit -m "hex: overlay schema with ELF32 header definition + field decoder"
```

---

## Task 15: HexRow component

**Files:**
- Create: `web/src/modules/hex/HexRow.svelte`

- [ ] **Step 1: Write `web/src/modules/hex/HexRow.svelte`**

```svelte
<script lang="ts">
  import type { OverlayField } from '../../lib/hex/overlays';

  interface Props {
    rowAddr: number;
    bytes: Uint8Array;
    rowOffset: number; // byte offset in the whole file for this row
    overlays: ReadonlyArray<OverlayField>;
    onhover: (field: OverlayField | null) => void;
  }

  let { rowAddr, bytes, rowOffset, overlays, onhover }: Props = $props();

  // Pre-compute per-byte overlay membership for this row.
  function fieldFor(localIdx: number): OverlayField | null {
    const fileOffset = rowOffset + localIdx;
    for (const f of overlays) {
      if (fileOffset >= f.offset && fileOffset < f.offset + f.size) return f;
    }
    return null;
  }

  function hex2(n: number): string {
    return n.toString(16).padStart(2, '0').toUpperCase();
  }

  function hex8(n: number): string {
    return '0x' + n.toString(16).padStart(8, '0').toUpperCase();
  }

  function ascii(n: number): string {
    return (n >= 0x20 && n <= 0x7E) ? String.fromCharCode(n) : '.';
  }
</script>

<div class="row">
  <span class="addr">{hex8(rowAddr)}</span>
  <span class="bytes">
    {#each Array.from(bytes) as b, i (i)}
      {@const f = fieldFor(i)}
      {#if f}
        <span class="ovr" onmouseenter={() => onhover(f)} onmouseleave={() => onhover(null)}>{hex2(b)}</span>
      {:else}
        <span>{hex2(b)}</span>
      {/if}
      {#if i === 7}<span class="mid"> </span>{/if}
      {#if i < bytes.length - 1}<span> </span>{/if}
    {/each}
  </span>
  <span class="ascii">
    {#each Array.from(bytes) as b, i (i)}
      {@const f = fieldFor(i)}
      {#if f}
        <span class="ovr">{ascii(b)}</span>
      {:else}
        <span>{ascii(b)}</span>
      {/if}
      {#if i === 7}<span class="mid"> </span>{/if}
    {/each}
  </span>
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: 100px 1fr 170px;
    gap: 22px;
    padding: 2px 0;
    align-items: center;
    font-size: 11px;
    line-height: 20px;
    height: 20px;
    white-space: nowrap;
  }
  .addr { color: var(--muted); }
  .bytes { letter-spacing: 0.04em; }
  .bytes .ovr { background: var(--mint-pale); padding: 1px 1px; }
  .bytes .ovr:hover { background: var(--mint); }
  .ascii { color: var(--muted); }
  .ascii .ovr { background: var(--mint-pale); padding: 1px 1px; color: var(--ink); }
  .mid { display: inline-block; width: 8px; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/modules/hex/HexRow.svelte
git commit -m "hex: HexRow renders one 16-byte row with overlay tints"
```

---

## Task 16: OverlayTip component

**Files:**
- Create: `web/src/modules/hex/OverlayTip.svelte`

- [ ] **Step 1: Write `web/src/modules/hex/OverlayTip.svelte`**

```svelte
<script lang="ts">
  import type { OverlayField } from '../../lib/hex/overlays';
  import { decodeField } from '../../lib/hex/overlays';

  interface Props {
    field: OverlayField;
    bytes: Uint8Array;
  }

  let { field, bytes }: Props = $props();

  let decoded = $derived(decodeField(bytes, field));

  function fmt(v: number | string, f: OverlayField): string {
    if (typeof v === 'string') return v;
    if (f.type === 'u32' && v > 0xFFFF) return '0x' + v.toString(16).padStart(8, '0').toUpperCase() + ` (${v})`;
    if (f.type === 'u16') return '0x' + v.toString(16).padStart(4, '0').toUpperCase() + ` (${v})`;
    if (f.type === 'u8')  return '0x' + v.toString(16).padStart(2, '0').toUpperCase() + ` (${v})`;
    return String(v);
  }
</script>

<div class="tip">
  <div class="head">
    <span class="l">FIELD</span>
    <span class="n">{field.name}</span>
  </div>
  <div class="row">
    <span class="l">OFFSET</span>
    <span class="v">0x{field.offset.toString(16).padStart(2, '0').toUpperCase()}</span>
  </div>
  <div class="row">
    <span class="l">TYPE</span>
    <span class="v">{field.type}{field.endian ? ' ' + field.endian : ''}</span>
  </div>
  <div class="row">
    <span class="l">VALUE</span>
    <span class="v mint">{fmt(decoded, field)}</span>
  </div>
  {#if field.description}
    <p class="desc">{field.description}</p>
  {/if}
</div>

<style>
  .tip {
    background: var(--mint-pale);
    border-left: 2px solid var(--mint-deep);
    padding: 12px 16px;
    font-size: 11px;
    margin-top: 14px;
  }
  .head, .row {
    display: grid;
    grid-template-columns: 70px 1fr;
    gap: 12px;
    padding: 2px 0;
  }
  .l { font-size: 9px; letter-spacing: 0.14em; color: var(--mint-deep); }
  .n { font-weight: 600; color: var(--ink); }
  .v { color: var(--ink); }
  .v.mint { color: var(--mint-deep); font-weight: 500; }
  .desc {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid var(--rule);
    color: var(--muted);
    font-size: 10px;
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/modules/hex/OverlayTip.svelte
git commit -m "hex: OverlayTip shows field name, offset, type, decoded value"
```

---

## Task 17: Hex module — virtualized viewer

**Files:**
- Create: `web/src/modules/hex/Hex.svelte`

- [ ] **Step 1: Write `web/src/modules/hex/Hex.svelte`**

```svelte
<script lang="ts">
  import { fileStore } from '../../lib/stores/file.svelte';
  import { detectFormat } from '../../lib/format/detect';
  import { visibleRange } from '../../lib/hex/virtualize';
  import { ELF32_HEADER_OVERLAY, type OverlayField, type OverlaySchema } from '../../lib/hex/overlays';
  import HexRow from './HexRow.svelte';
  import OverlayTip from './OverlayTip.svelte';

  const ROW_HEIGHT = 20;
  const BYTES_PER_ROW = 16;
  const OVERSCAN = 6;

  let scrollContainer: HTMLDivElement;
  let scrollTop = $state(0);
  let viewportHeight = $state(400);
  let jumpHex = $state('');
  let hovered = $state<OverlayField | null>(null);

  let bytes = $derived(fileStore.bytes ?? new Uint8Array(0));
  let totalRows = $derived(Math.ceil(bytes.byteLength / BYTES_PER_ROW));

  let overlays = $derived<OverlaySchema>(
    bytes.byteLength > 0 && detectFormat(bytes) === 'elf' ? ELF32_HEADER_OVERLAY : []
  );

  let range = $derived(visibleRange({
    scrollTop, viewportHeight,
    rowHeight: ROW_HEIGHT, totalRows, overscan: OVERSCAN
  }));

  function onScroll(): void {
    scrollTop = scrollContainer.scrollTop;
  }

  function onJump(): void {
    const n = parseInt(jumpHex.replace(/^0x/i, ''), 16);
    if (Number.isNaN(n) || n < 0 || n >= bytes.byteLength) return;
    const row = Math.floor(n / BYTES_PER_ROW);
    scrollContainer.scrollTop = row * ROW_HEIGHT;
  }

  function rowSlice(rowIdx: number): Uint8Array {
    const start = rowIdx * BYTES_PER_ROW;
    const end = Math.min(start + BYTES_PER_ROW, bytes.byteLength);
    return bytes.subarray(start, end);
  }

  function measureViewport(node: HTMLDivElement): { destroy(): void } {
    const ro = new ResizeObserver(() => {
      viewportHeight = node.clientHeight;
    });
    ro.observe(node);
    viewportHeight = node.clientHeight;
    return { destroy: () => ro.disconnect() };
  }
</script>

<section class="hex-wrap">
  <header class="hex-bar">
    <span class="title">HEX · {bytes.byteLength.toLocaleString()} bytes</span>
    <form onsubmit={(e) => { e.preventDefault(); onJump(); }}>
      <label class="lab">GOTO</label>
      <input
        type="text"
        placeholder="0x00000000"
        bind:value={jumpHex}
        spellcheck="false"
        autocomplete="off"
      >
    </form>
  </header>

  <div
    bind:this={scrollContainer}
    class="hex-scroll"
    onscroll={onScroll}
    use:measureViewport
  >
    <div style="height: {range.topPad}px"></div>
    {#each Array.from({ length: range.end - range.start }, (_, i) => range.start + i) as rowIdx (rowIdx)}
      <HexRow
        rowAddr={rowIdx * BYTES_PER_ROW}
        rowOffset={rowIdx * BYTES_PER_ROW}
        bytes={rowSlice(rowIdx)}
        overlays={overlays}
        onhover={(f) => hovered = f}
      />
    {/each}
    <div style="height: {range.bottomPad}px"></div>
  </div>

  {#if hovered}
    <OverlayTip field={hovered} bytes={bytes} />
  {/if}
</section>

<style>
  .hex-wrap {
    display: grid;
    grid-template-rows: auto 1fr auto;
    height: 100%;
    padding: 0 22px 22px;
  }
  .hex-bar {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 16px 0 12px;
    border-bottom: 1px solid var(--grey);
    margin-bottom: 12px;
  }
  .title {
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted);
  }
  form {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .lab {
    font-size: 9px;
    letter-spacing: 0.14em;
    color: var(--mint-deep);
  }
  input {
    font-family: var(--mono);
    font-size: 11px;
    padding: 5px 8px;
    background: var(--paper);
    border: 1px solid var(--grey);
    border-radius: 3px;
    width: 130px;
  }
  input:focus { outline: none; border-color: var(--mint-deep); }
  .hex-scroll {
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/modules/hex/Hex.svelte
git commit -m "hex: virtualized viewer with goto + overlay engine"
```

---

## Task 18: Compose the App shell

**Files:**
- Modify: `web/src/App.svelte`

- [ ] **Step 1: Replace `web/src/App.svelte` with the real shell**

```svelte
<script lang="ts">
  import Header from './shell/Header.svelte';
  import TabBar from './shell/TabBar.svelte';
  import FileRail from './shell/FileRail.svelte';
  import StatusBar from './shell/StatusBar.svelte';
  import Empty from './modules/empty/Empty.svelte';
  import Hex from './modules/hex/Hex.svelte';
  import { fileStore } from './lib/stores/file.svelte';
  import { router } from './lib/stores/router.svelte';

  // When a file lands, route to Hex if we're still on empty.
  $effect(() => {
    if (fileStore.bytes && router.route === 'empty') {
      router.go('hex');
    }
    if (!fileStore.bytes && router.route !== 'empty') {
      router.go('empty');
    }
  });
</script>

<div class="app">
  <Header />
  <TabBar />
  <div class="s-body">
    <FileRail />
    <main class="s-main">
      {#if router.route === 'hex' && fileStore.bytes}
        <Hex />
      {:else}
        <Empty />
      {/if}
    </main>
  </div>
  <StatusBar />
</div>
```

- [ ] **Step 2: Run dev server and smoke-test**

Run: `npm run dev`

Expected: visiting `http://localhost:5173/scry/` shows the full app shell: header, disabled tabs (except HEX which is also disabled until a file loads), drop zone in the body, status bar at bottom, mint stripe across the top.

Drag any binary file onto the page (or click "Choose file"). Expected: HEX tab activates, view switches to Hex showing rows of bytes with addresses.

If the file is an ELF (e.g. `/usr/bin/ls` copied locally), the first 52 bytes show with mint tinting; hovering any tinted byte reveals the overlay tip with the field name and decoded value.

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add web/src/App.svelte
git commit -m "app: compose shell - header, tabs, rail, main, status, drop-to-hex flow"
```

---

## Task 19: Build script

**Files:**
- Create: `scripts/build.sh`

- [ ] **Step 1: Write `scripts/build.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[scry] building web..."
cd "$ROOT/web"
npm run build

echo "[scry] build complete. artifacts in web/dist/"
ls -la "$ROOT/web/dist" | head -20
```

- [ ] **Step 2: Make it executable and run it**

Run:
```bash
chmod +x ~/dev/scry/scripts/build.sh
~/dev/scry/scripts/build.sh
```

Expected: Vite builds, `web/dist/` contains `index.html`, an `assets/` folder with hashed JS/CSS.

- [ ] **Step 3: Commit**

```bash
git add scripts/build.sh
git commit -m "scripts: build.sh runs vite build"
```

---

## Task 20: Deploy script

**Files:**
- Create: `scripts/deploy.sh`

- [ ] **Step 1: Write `scripts/deploy.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$HOME/dev/goolz/scry"

if [ ! -d "$ROOT/web/dist" ]; then
  echo "[scry] no build artifacts. run scripts/build.sh first."
  exit 1
fi

if [ ! -d "$TARGET" ]; then
  echo "[scry] target $TARGET does not exist. is goolz repo cloned?"
  exit 1
fi

echo "[scry] syncing web/dist/ -> $TARGET ..."
# Preserve docs/scope.html landing if it's the only thing there (we replace it
# with the real build).
rsync -a --delete --exclude='.git*' "$ROOT/web/dist/" "$TARGET/"

echo "[scry] committing in goolz..."
cd "$HOME/dev/goolz"

if git diff --quiet HEAD -- scry/; then
  echo "[scry] no changes in goolz/scry/. nothing to commit."
  exit 0
fi

git add scry/
# ASCII-only commit message (CF Pages wrangler-action fails on unicode).
git commit -m "scry: deploy web build $(date +%Y-%m-%d-%H%M)"
git push

echo "[scry] deployed. cloudflare pages will pick it up shortly."
echo "[scry] check https://goolz.org/scry"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x ~/dev/scry/scripts/deploy.sh`

- [ ] **Step 3: Commit**

```bash
git add scripts/deploy.sh
git commit -m "scripts: deploy.sh syncs dist + commits + pushes goolz"
```

---

## Task 21: First real deploy

**Files:** (no new files)

- [ ] **Step 1: Build**

Run:
```bash
~/dev/scry/scripts/build.sh
```

Expected: clean build, no errors.

- [ ] **Step 2: Deploy**

Run:
```bash
~/dev/scry/scripts/deploy.sh
```

Expected: rsync output, goolz commit + push, message linking to `goolz.org/scry`.

- [ ] **Step 3: Verify**

Wait 30-90 seconds for Cloudflare Pages to deploy. Visit `https://goolz.org/scry`.

Expected: the app shell loads. Mint stripe, drop zone, JetBrains Mono throughout. Drop any binary; HEX view renders.

If the page is broken, check:
- Browser console for asset 404s (means `base: '/scry/'` is wrong)
- That the build went into `web/dist/` (not some other directory)
- That `goolz/scry/` actually got the new files (not stale)

- [ ] **Step 4: Push the scry source repo**

Run:
```bash
cd ~/dev/scry && git push
```

Expected: all foundation commits pushed to `github.com/melonmelonz/scry`.

---

## Self-Review

**Spec coverage:** This plan covers spec §3 (aesthetic), §4 (architecture — JS shell side), §6.1 (Shell), §6.3 (Hex + struct overlays). It deliberately defers §6.2 (Inspect, needs Rust), §6.4 (Disasm), §6.5 (Emu), §6.6 (Trace), §6.7 (Bus bridge) to subsequent plans. Deploy (§11) is fully covered.

**Placeholder scan:** All code blocks contain complete, runnable code. No "TBD" entries. Test cases are concrete. Commit messages are concrete.

**Type consistency:** `FormatKind`, `RouteId`, `OverlayField`, `OverlaySchema`, `VRange`, `VRangeInput` are used consistently across the tasks that reference them. `fileStore.bytes` is `Uint8Array | null` throughout. `router.route` is `RouteId` throughout.

**One refinement noted but not blocking:** Task 14's `decodeField` returns `number | string` and Task 16's `OverlayTip` uses `typeof v === 'string'` to discriminate — works correctly for the v1 schema. If a future field type adds non-string non-number values, the union widens.

---

## Execution Handoff

Plan complete and saved to `~/dev/scry/docs/superpowers/plans/2026-05-11-foundation-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for momentum since the user said "gogogo."

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Slower, more visibility per step.

Which approach?
