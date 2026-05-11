import { loadFile } from '../stores/file.js';
import { el } from '../dom.js';
import { buildDemoElf, DEMO_NAME } from '../demo/rv32_demo.js';

async function readFile(file) {
  const buf = await file.arrayBuffer();
  loadFile(file.name, new Uint8Array(buf));
}

export function createEmpty() {
  const input = el('input', { type: 'file', hidden: 'hidden' });
  const pick = el('button', { class: 'pick', type: 'button', text: 'Choose file' });
  const demo = el('button', { class: 'pick demo', type: 'button', text: 'Load RV32 demo' });
  const zone = el('div', { class: 'zone' }, [
    el('h2', { text: 'Drop a binary to begin.' }),
    el('p', { class: 'subtitle', text: 'ELF \u00B7 Saleae .sal \u00B7 raw bytes' }),
    pick,
    demo,
    input
  ]);
  const host = el('section', { class: 's-empty' }, [zone]);

  host.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('over');
  });
  host.addEventListener('dragleave', () => {
    zone.classList.remove('over');
  });
  host.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const file = e.dataTransfer?.files?.[0];
    if (file) await readFile(file);
  });

  pick.addEventListener('click', () => input.click());
  demo.addEventListener('click', () => {
    loadFile(DEMO_NAME, buildDemoElf());
  });
  input.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) await readFile(file);
  });

  return host;
}
