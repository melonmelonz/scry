import { loadFile, ingestFile, setLoading, fileStore } from '../stores/file.js';
import { el } from '../dom.js';
import { buildDemoElf, DEMO_NAME } from '../demo/rv32_demo.js';

async function loadSample(file) {
  setLoading(`fetching ${file}\u2026`);
  await new Promise(r => requestAnimationFrame(() => r()));
  const res = await fetch(`samples/${file}`);
  if (!res.ok) {
    fileStore.set({ name: null, bytes: null, loading: false, status: `fetch failed: ${res.status}` });
    throw new Error(`sample fetch failed: ${res.status}`);
  }
  setLoading(`reading ${file}\u2026`);
  await new Promise(r => requestAnimationFrame(() => r()));
  const bytes = new Uint8Array(await res.arrayBuffer());
  loadFile(file, bytes);
}

async function fetchManifest() {
  try {
    const res = await fetch('samples/manifest.json');
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export function createEmpty() {
  const input = el('input', { type: 'file', hidden: 'hidden' });
  const pick = el('button', { class: 'pick', type: 'button', text: 'Choose file' });
  const demo = el('button', { class: 'pick demo', type: 'button', text: 'Load RV32 demo' });
  const samples = el('div', { class: 'samples' });
  const zone = el('div', { class: 'zone' }, [
    el('h2', { text: 'Drop a binary to begin.' }),
    el('p', { class: 'subtitle', text: 'ELF \u00B7 Saleae .sal \u00B7 raw bytes' }),
    pick,
    demo,
    input,
    samples
  ]);
  const host = el('section', { class: 's-empty' }, [zone]);

  fetchManifest().then(list => {
    if (!list.length) return;
    samples.appendChild(el('div', { class: 'samples-label', text: 'OR PICK A SAMPLE' }));
    const row = el('div', { class: 'samples-row' });
    for (const s of list) {
      const b = el('button', { class: 'sample', type: 'button', text: s.file });
      b.title = `${s.desc} \u2014 ${s.insns} instructions`;
      b.addEventListener('click', () => loadSample(s.file).catch(console.error));
      row.appendChild(b);
    }
    samples.appendChild(row);
    const note = el('p', { class: 'samples-note' }, [
      el('span', { text: list.map(s => `${s.file} \u2014 ${s.desc}`).join('  \u00B7  ') })
    ]);
    samples.appendChild(note);
  });

  host.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('over');
  });
  host.addEventListener('dragleave', () => {
    zone.classList.remove('over');
  });
  host.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const file = e.dataTransfer?.files?.[0];
    if (file) ingestFile(file);
  });

  pick.addEventListener('click', () => input.click());
  demo.addEventListener('click', () => {
    loadFile(DEMO_NAME, buildDemoElf());
  });
  input.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) ingestFile(file);
  });

  // Loading overlay inside the zone. Reflects fileStore.loading + status.
  const loadingEl = el('div', { class: 'zone-loading', text: '' });
  zone.appendChild(loadingEl);
  fileStore.subscribe(s => {
    if (s.loading) {
      zone.classList.add('loading');
      loadingEl.textContent = s.status || 'loading\u2026';
    } else {
      zone.classList.remove('loading');
      loadingEl.textContent = s.status || '';
    }
  });

  return host;
}
