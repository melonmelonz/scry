import { loadFile, ingestFile, setLoading, fileStore } from '../stores/file.js';
import { el } from '../dom.js';
import { buildDemoElf, DEMO_NAME } from '../demo/rv32_demo.js';
import { entropyBlocks } from '../hex/entropy.js';

// Only allow .elf samples with a strict character set. The manifest is
// produced by us at build time, but defense in depth: if someone tampered
// with the served file, we still refuse to follow `../etc/passwd` style names.
const SAMPLE_NAME_OK = /^[A-Za-z0-9._-]+\.(elf|wav|gba)$/;
const THUMB_BLOCKS = 12;

// Cached entropy thumbnails per sample filename, surviving re-mounts of the
// empty module across file-clear cycles.
const thumbCache = new Map();

async function loadSample(file) {
  if (!SAMPLE_NAME_OK.test(file)) {
    fileStore.set({ name: null, bytes: null, loading: false, status: `sample blocked: bad name "${file}"` });
    throw new Error(`bad sample name: ${file}`);
  }
  setLoading(`fetching ${file}\u2026`);
  await new Promise(r => requestAnimationFrame(() => r()));
  const res = await fetch(`samples/${encodeURIComponent(file)}`);
  if (!res.ok) {
    fileStore.set({ name: null, bytes: null, loading: false, status: `fetch failed: ${res.status}` });
    throw new Error(`sample fetch failed: ${res.status}`);
  }
  setLoading(`reading ${file}\u2026`);
  await new Promise(r => requestAnimationFrame(() => r()));
  const bytes = new Uint8Array(await res.arrayBuffer());
  // Opportunistically cache the entropy thumb so a subsequent mount renders
  // instantly without a refetch.
  if (!thumbCache.has(file)) {
    thumbCache.set(file, entropyBlocks(bytes, THUMB_BLOCKS));
  }
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

async function fetchThumb(file) {
  if (thumbCache.has(file)) return thumbCache.get(file);
  if (!SAMPLE_NAME_OK.test(file)) return null;
  try {
    const res = await fetch(`samples/${encodeURIComponent(file)}`);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const e = entropyBlocks(bytes, THUMB_BLOCKS);
    thumbCache.set(file, e);
    return e;
  } catch {
    return null;
  }
}

function buildThumb(entropy) {
  const host = el('span', { class: 'sample-thumb' });
  for (let i = 0; i < THUMB_BLOCKS; i++) {
    const ratio = Math.max(0, Math.min(1, entropy[i] / 8));
    const bar = el('span', { class: 'sample-thumb-bar' });
    bar.style.height = `${(ratio * 100).toFixed(1)}%`;
    host.appendChild(bar);
  }
  return host;
}

function buildThumbPlaceholder() {
  // Shimmer placeholder that occupies the same footprint as the real thumb,
  // so the row doesn't reflow once the entropy promise resolves.
  const host = el('span', { class: 'sample-thumb shimmer' });
  for (let i = 0; i < THUMB_BLOCKS; i++) {
    host.appendChild(el('span', { class: 'sample-thumb-bar' }));
  }
  return host;
}

export function createEmpty() {
  const input = el('input', { type: 'file', hidden: 'hidden' });
  const pick = el('button', { class: 'pick', type: 'button', text: 'Choose file' });
  const samples = el('div', { class: 'samples' });
  const zone = el('div', { class: 'zone' }, [
    el('h2', { text: 'Drop a binary to begin.' }),
    el('p', { class: 'subtitle', text: 'ELF \u00B7 WAV \u00B7 GBA \u00B7 raw bytes' }),
    pick,
    input,
    samples
  ]);
  const host = el('section', { class: 's-empty' }, [zone]);

  fetchManifest().then(list => {
    if (!list.length) return;
    samples.appendChild(el('div', { class: 'samples-label', text: 'OR PICK A SAMPLE' }));
    const row = el('div', { class: 'samples-row' });
    for (const s of list) {
      const thumbSlot = el('span', { class: 'sample-thumb-slot' }, [buildThumbPlaceholder()]);
      const label = el('span', { class: 'sample-label', text: s.file });
      const b = el('button', { class: 'sample', type: 'button' }, [thumbSlot, label]);
      b.title = s.insns > 0 ? `${s.desc} \u2014 ${s.insns} instructions` : s.desc;
      b.addEventListener('click', () => loadSample(s.file).catch(console.error));
      row.appendChild(b);

      // Lazy entropy thumb. If a fetch returns after the picker is gone
      // (file already loaded), the DOM swap is a no-op against an unparented
      // node — harmless.
      fetchThumb(s.file).then(e => {
        if (!e) return;
        thumbSlot.replaceChildren(buildThumb(e));
      });
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
    // Stop here: main.js attaches a window-level drop handler that also calls
    // ingestFile. Without stopPropagation the same file ingests twice in
    // parallel, firing fileStore.set 6+ times and re-running every subscriber
    // (entropy strip, hex render) each time. On a 16 MiB GBA cart the page
    // feels stuck under that load.
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove('over');
    const file = e.dataTransfer?.files?.[0];
    if (file) ingestFile(file);
  });

  pick.addEventListener('click', () => input.click());
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
