import { createHeader } from './shell/header.js';
import { createTabBar } from './shell/tabbar.js';
import { createFileRail } from './shell/filerail.js';
import { createStatusBar } from './shell/statusbar.js';
import { createEmpty } from './modules/empty.js';
import { createHex } from './modules/hex.js';
import { createInspect } from './modules/inspect.js';
import { createDisasm } from './modules/disasm.js';
import { createEmu } from './modules/emu.js';
import { fileStore } from './stores/file.js';
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
    emu:     createEmu
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
