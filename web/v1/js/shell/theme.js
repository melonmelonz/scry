// Theme toggle. Three states the user can land in:
//   - explicit "light"  (data-theme="light"  on <html>, stored)
//   - explicit "dark"   (data-theme="dark"   on <html>, stored)
//   - system            (no data-theme attr, falls through to @media query)
//
// Storage key is only written for explicit choices. Clearing the attribute
// + key returns to system-follow, but the button just toggles between
// the two explicit modes since that's what users expect.

const KEY = 'scry-theme';

function currentMode() {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  // No explicit override — derive from system.
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyMode(mode) {
  if (mode === 'light' || mode === 'dark') {
    document.documentElement.setAttribute('data-theme', mode);
    try { localStorage.setItem(KEY, mode); } catch (e) { /* ignore */ }
  }
}

export function createThemeToggle() {
  const btn = document.createElement('button');
  btn.className = 's-theme';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Toggle dark mode');

  function render() {
    const mode = currentMode();
    // Show the icon for what you'd switch TO (affordance), not the current state.
    btn.textContent = mode === 'dark' ? '\u263C' : '\u263E'; // sun : moon
    btn.title = mode === 'dark' ? 'Switch to light' : 'Switch to dark';
  }

  btn.addEventListener('click', () => {
    applyMode(currentMode() === 'dark' ? 'light' : 'dark');
    render();
  });

  // Track system changes when the user hasn't picked an explicit mode.
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', () => {
    if (!document.documentElement.hasAttribute('data-theme')) render();
  });

  render();
  return btn;
}
