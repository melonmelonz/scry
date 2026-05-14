import { createHeader } from './shell/header.js';
import { createTabBar } from './shell/tabbar.js';
import { createFileRail } from './shell/filerail.js';
import { createStatusBar } from './shell/statusbar.js';
import { createEmpty } from './modules/empty.js';
import { createHex } from './modules/hex.js';
import { createInspect } from './modules/inspect.js';
import { createDisasm } from './modules/disasm.js';
import { createEmu } from './modules/emu.js';
import { createTrace } from './modules/trace.js';
import { createWave } from './modules/wave.js';
import { createGame } from './modules/game.js';
import { fileStore, ingestFile, loadFile } from './stores/file.js';
import { router } from './stores/router.js';
import { detectFormat } from './format/detect.js';
import { buildDemoElf, DEMO_NAME } from './demo/rv32_demo.js';

function mount() {
  const root = document.getElementById('app');
  if (!root) return;

  const app = document.createElement('div');
  app.className = 'app';

  const header = createHeader();
  const tabs = createTabBar();
  const body = document.createElement('div');
  body.className = 's-body';
  const rail = createFileRail();
  const main = document.createElement('main');
  main.className = 's-main';
  body.appendChild(rail);
  body.appendChild(main);
  const status = createStatusBar();

  app.appendChild(header);
  app.appendChild(tabs);
  app.appendChild(body);
  app.appendChild(status);

  root.appendChild(app);

  // Lazily-built module elements.
  const factories = {
    empty:   createEmpty,
    hex:     createHex,
    inspect: createInspect,
    disasm:  createDisasm,
    emu:     createEmu,
    trace:   createTrace,
    wave:    createWave,
    game:    createGame
  };
  const mounted = {};

  function defaultRouteForFile() {
    const bytes = fileStore.get().bytes;
    if (!bytes) return 'empty';
    const fmt = detectFormat(bytes);
    if (fmt === 'elf') return 'inspect';
    if (fmt === 'wav') return 'wave';
    if (fmt === 'gba') return 'game';
    return 'hex';
  }

  function showRoute(route) {
    const hasFile = fileStore.get().bytes !== null;
    let target = route;

    // Auto-redirects.
    if (!hasFile && target !== 'empty') target = 'empty';
    if (hasFile && target === 'empty') target = defaultRouteForFile();

    // Re-gate against disabled routes. If the current tab isn't valid for the
    // newly-loaded format, fall back to the format's "best landing" tab —
    // never silently drop the user into HEX when (say) WAVE was the natural
    // home for the file they just opened.
    if (hasFile) {
      const fmt = detectFormat(fileStore.get().bytes);
      if (target === 'inspect' && fmt !== 'elf') target = defaultRouteForFile();
      if (target === 'wave'    && fmt !== 'wav') target = defaultRouteForFile();
      if (target === 'game'    && fmt !== 'gba') target = defaultRouteForFile();
    }

    if (target !== route) {
      router.go(target);
      return;
    }

    if (!mounted[target] && factories[target]) {
      console.time(`[scry/dbg] mount ${target}`);
      mounted[target] = factories[target]();
      console.timeEnd(`[scry/dbg] mount ${target}`);
      console.time(`[scry/dbg] appendChild ${target}`);
      main.appendChild(mounted[target]);
      console.timeEnd(`[scry/dbg] appendChild ${target}`);
    }
    for (const k of Object.keys(mounted)) {
      mounted[k].style.display = (k === target) ? '' : 'none';
    }
  }

  router.subscribe(showRoute);
  fileStore.subscribe(() => showRoute(router.route));

  // Global drag-drop: accept a binary anywhere on the page, not just the
  // empty drop zone (which is hidden once a file is loaded).
  const dropOverlay = document.createElement('div');
  dropOverlay.className = 'global-drop';
  dropOverlay.textContent = 'release to load';
  app.appendChild(dropOverlay);

  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
    dragDepth++;
    dropOverlay.classList.add('on');
  });
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
    }
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropOverlay.classList.remove('on');
  });
  // Parent shell (unified embed) can push a "load demo" command so the user
  // gets a one-click way to see the workbench populated without leaving the
  // outer chrome.
  window.addEventListener('message', (ev) => {
    if (ev.origin !== location.origin) return;
    const m = ev.data;
    if (m && m.type === 'scry-load-demo') {
      loadFile(DEMO_NAME, buildDemoElf());
    }
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.classList.remove('on');
    const file = e.dataTransfer?.files?.[0];
    if (file) ingestFile(file);
  });

  // Global loading banner above the status bar, shows progress messages.
  const banner = document.createElement('div');
  banner.className = 'global-loading';
  app.appendChild(banner);
  fileStore.subscribe(s => {
    if (s.loading) {
      banner.classList.add('on');
      banner.textContent = s.status || 'loading\u2026';
    } else if (s.status) {
      // Brief non-loading message (e.g. error)
      banner.classList.remove('on');
      banner.classList.add('flash');
      banner.textContent = s.status;
      setTimeout(() => banner.classList.remove('flash'), 2500);
    } else {
      banner.classList.remove('on');
      banner.classList.remove('flash');
      banner.textContent = '';
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
