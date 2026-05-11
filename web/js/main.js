import { createHeader } from './shell/header.js';
import { createTabBar } from './shell/tabbar.js';
import { createFileRail } from './shell/filerail.js';
import { createStatusBar } from './shell/statusbar.js';
import { createEmpty } from './modules/empty.js';
import { createHex } from './modules/hex.js';
import { fileStore } from './stores/file.js';
import { router } from './stores/router.js';

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

  // Module mount table. Each entry is { route -> factory }. Modules are lazily
  // created the first time their route is visited, then reused (kept in DOM
  // but display:none when inactive).
  const factories = {
    empty: createEmpty,
    hex:   createHex
  };
  const mounted = {}; // route -> element

  function showRoute(route) {
    // Auto-redirect: when a file lands, leave 'empty'; when it clears, return.
    const hasFile = fileStore.get().bytes !== null;
    let target = route;
    if (hasFile && target === 'empty') target = 'hex';
    if (!hasFile && target !== 'empty') target = 'empty';
    if (target !== route) {
      // navigate, which will re-fire this subscriber.
      router.go(target);
      return;
    }

    // Lazy-mount.
    if (!mounted[target] && factories[target]) {
      mounted[target] = factories[target]();
      main.appendChild(mounted[target]);
    }
    // Toggle visibility.
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
