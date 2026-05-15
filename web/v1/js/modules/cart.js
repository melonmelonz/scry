// CART pane — DOM-mirror of v2's Cart.svelte (lib/Cart.svelte). v2 calls
// into Rust (scry-core::parse_gba) for the structural header decode; v1
// ports that to pure JS so the V1/V2 toggle shows pixel-identical output.
// All class names are `c-*` and css/cart.css is a verbatim port of v2's
// <style> block.

import { fileStore } from '../stores/file.js';
import { el, replaceChildren } from '../dom.js';
import { hex2, hex8, fmtBytes, readAsciiZ, asciiCh } from '../fmt.js';

// Parse the GBA cart header. Mirrors what scry-core::parse_gba returns to
// v2. Fields:
//   title             — 12 bytes ASCII at 0xA0 (NUL-trimmed)
//   game_code         — 4 bytes ASCII at 0xAC
//   maker_code        — 2 bytes ASCII at 0xB0
//   fixed             — byte at 0xB2, must equal 0x96
//   unit_code         — byte at 0xB3 (main_unit_code)
//   device_type       — byte at 0xB4
//   version           — byte at 0xBC
//   checksum          — byte at 0xBD (complement)
//   checksum_computed — Nintendo header checksum: sum bytes 0xA0..=0xBC,
//                       negate, subtract 0x19, mask to 8 bits.
//   rom_size          — total byteLength
function parseGba(bytes) {
  if (!bytes || bytes.byteLength < 0xC0) return null;
  const title       = readAsciiZ(bytes, 0xA0, 12);
  const game_code   = readAsciiZ(bytes, 0xAC, 4);
  const maker_code  = readAsciiZ(bytes, 0xB0, 2);
  const fixed       = bytes[0xB2];
  const unit_code   = bytes[0xB3];
  const device_type = bytes[0xB4];
  const version     = bytes[0xBC];
  const checksum    = bytes[0xBD];

  // Header checksum: -(sum(0xA0..=0xBC)) - 0x19, mod 256.
  let sum = 0;
  for (let i = 0xA0; i <= 0xBC; i++) sum = (sum + bytes[i]) & 0xFF;
  const checksum_computed = ((-sum - 0x19) & 0xFF);

  return {
    title,
    game_code,
    maker_code,
    fixed,
    fixed_ok: fixed === 0x96,
    unit_code,
    device_type,
    version,
    checksum,
    checksum_computed,
    checksum_ok: checksum === checksum_computed,
    rom_size: bytes.byteLength,
  };
}

// Render a 16-byte window as { off, hex, ascii }. The hex column includes
// an extra space after byte 7 (matches v2's `if (i === 7) hexs.push('')`
// which produces a double-space gap when joined).
function makeRow(bytes, off) {
  const end = Math.min(bytes.length, off + 16);
  const slice = bytes.subarray(off, end);
  const hexs = [];
  const asc  = [];
  for (let i = 0; i < slice.length; i++) {
    hexs.push(hex2(slice[i]));
    asc.push(asciiCh(slice[i]));
    if (i === 7) hexs.push('');
  }
  return { off, hex: hexs.join(' ').replace(/  /g, '  '), ascii: asc.join('') };
}

function headerRows(bytes) {
  if (!bytes) return [];
  const out = [];
  for (let off = 0xA0; off < 0xE0; off += 16) {
    out.push(makeRow(bytes, off));
  }
  return out;
}

export function createCart() {
  // ── top bar ───────────────────────────────────────────────────────────
  const cTitle = el('span', { class: 'c-title', text: '[ GBA / CARTRIDGE ]' });
  const cMeta  = el('span', { class: 'c-meta', text: '' });
  const cBar   = el('div',  { class: 'c-bar' }, [cTitle, cMeta]);

  // ── body host (swapped between empty / parsed) ────────────────────────
  const body = el('div', { class: 'c-body' });
  const wrap = el('section', { class: 'c-wrap' }, [cBar, body]);

  function renderEmpty(msg) {
    cMeta.textContent = '';
    replaceChildren(body, [el('div', { class: 'c-empty', text: msg })]);
  }

  function renderError(msg) {
    cMeta.textContent = '';
    replaceChildren(body, [el('div', { class: 'c-empty', text: `parse failed: ${msg}` })]);
  }

  function renderHeader(bytes, header) {
    // ── meta line in top bar (matches game.js's cartMetaText style) ─────
    const titleStr = header.title || '(blank)';
    const codeStr  = header.game_code || '----';
    cMeta.textContent = `"${titleStr}" \u00B7 ${codeStr} \u00B7 ${fmtBytes(header.rom_size)}`;

    // ── left col: decoded header rows ───────────────────────────────────
    const decodedTitle = el('div', { class: 'c-section-title', text: '[ DECODED HEADER ]' });

    const mkRow = (label, valueChildren) => {
      const l = el('span', { class: 'l', text: label });
      const v = el('span', { class: 'v' }, valueChildren);
      return el('div', { class: 'c-row' }, [l, v]);
    };

    const rows = [
      mkRow('TITLE',     [titleStr]),
      mkRow('GAME CODE', [codeStr]),
      mkRow('MAKER',     [header.maker_code || '--']),
      mkRow('FIXED',     [`0x${hex2(header.fixed)} ${header.fixed_ok ? '\u2713' : '\u2717'}`]),
      mkRow('UNIT CODE', [`0x${hex2(header.unit_code)}`]),
      mkRow('DEVICE',    [`0x${hex2(header.device_type)}`]),
      mkRow('VERSION',   [`0x${hex2(header.version)}`]),
      mkRow('CHECKSUM',  [
        `stored 0x${hex2(header.checksum)} \u00B7 computed 0x${hex2(header.checksum_computed)}${header.checksum_ok ? ' \u2713' : ' \u2717'}`
      ]),
      mkRow('SIZE',      [fmtBytes(header.rom_size)]),
    ];

    // Note paragraph. v2 uses inline <code> for scry-core::parse_gba and
    // gbajs; mirror that structure with real <code> children.
    const note = el('p', { class: 'c-note' }, [
      'V2 parses GBA cartridges in Rust (',
      el('code', { text: 'scry-core::parse_gba' }),
      ') and verifies the one-byte Nintendo header checksum (sum bytes 0xA0..=0xBC, negate, subtract 0x19). Emulation lives in V1\u2019s GAME pane (vendored ',
      el('code', { text: 'gbajs' }),
      '); the V2 port is on the roadmap.',
    ]);

    const cLeft = el('div', { class: 'c-col' }, [decodedTitle, ...rows, note]);

    // ── right col: header bytes 0xA0..0xDF as hex+ascii rows ────────────
    const bytesTitle = el('div', { class: 'c-section-title', text: '[ HEADER BYTES 0xA0\u20130xDF ]' });
    const hexHost    = el('div', { class: 'c-hex' });
    for (const r of headerRows(bytes)) {
      const addr  = el('span', { class: 'addr',  text: hex8(r.off) });
      const bs    = el('span', { class: 'bytes', text: r.hex });
      const ascii = el('span', { class: 'ascii', text: r.ascii });
      hexHost.appendChild(el('div', { class: 'c-hex-row' }, [addr, bs, ascii]));
    }
    const cRight = el('div', { class: 'c-col' }, [bytesTitle, hexHost]);

    const split = el('div', { class: 'c-split' }, [cLeft, cRight]);
    replaceChildren(body, [split]);
  }

  // ── react to file changes ─────────────────────────────────────────────
  const cartFileSub = (state) => {
    const bytes = state.bytes;
    if (!bytes) { renderEmpty('Parsing\u2026'); return; }
    if (state.kind !== 'gba') {
      // Mirror v2's behavior: it just calls parse_gba unconditionally and
      // surfaces errors. v1 gates on the cached `kind` so we don't print
      // garbage for non-GBA files.
      renderError('not a GBA cart');
      return;
    }
    try {
      const header = parseGba(bytes);
      if (!header) { renderError('header too short'); return; }
      renderHeader(bytes, header);
    } catch (e) {
      console.error('[scry/v1/cart] parse failed', e);
      renderError(String(e?.message || e));
    }
  };
  cartFileSub.__dbg = 'cart.fileSub';
  fileStore.subscribe(cartFileSub);

  return wrap;
}
