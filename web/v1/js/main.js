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
import { fileStore, ingestFile } from './stores/file.js';
import { router } from './stores/router.js';
import { detectFormat } from './format/detect.js';

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
    trace:   createTrace
  };
  const mounted = {};

  function defaultRouteForFile() {
    const bytes = fileStore.get().bytes;
    if (!bytes) return 'empty';
    // ELF lands on inspect; everything else on hex.
    return detectFormat(bytes) === 'elf' ? 'inspect' : 'hex';
  }

  function showRoute(route) {
    const hasFile = fileStore.get().bytes !== null;
    let target = route;

    // Auto-redirects.
    if (!hasFile && target !== 'empty') target = 'empty';
    if (hasFile && target === 'empty') target = defaultRouteForFile();

    // Re-gate against disabled routes (e.g. inspect when format isn't ELF).
    if (hasFile && target === 'inspect' && detectFormat(fileStore.get().bytes) !== 'elf') {
      target = 'hex';
    }

    if (target !== route) {
      router.go(target);
      return;
    }

    if (!mounted[target] && factories[target]) {
      mounted[target] = factories[target]();
      main.appendChild(mounted[target]);
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
