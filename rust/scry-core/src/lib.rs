//! scry-core — Rust → WASM façade for the v2 workbench.
//!
//! This crate is intentionally small. The wasm module exposes a handful of
//! pure functions that take a `&[u8]` of the loaded file and return JSON-ish
//! data structures via serde-wasm-bindgen. Svelte 5 in `web/v2/` consumes
//! them.

use goblin::elf::Elf;
use serde::Serialize;
use wasm_bindgen::prelude::*;

/// Set a panic hook on first call so wasm panics surface in the browser
/// console instead of disappearing into the void.
#[wasm_bindgen(start)]
pub fn _start() {
    console_error_panic_hook::set_once();
}

#[derive(Serialize)]
pub struct ElfSummary {
    pub class:    &'static str,
    pub data:     &'static str,
    pub osabi:    String,
    pub kind:     String,
    pub machine:  String,
    pub entry:    String,
    pub n_sections: usize,
    pub n_segments: usize,
    pub n_symbols:  usize,
    pub is_64:    bool,
}

#[derive(Serialize)]
pub struct ElfSection {
    pub idx:    usize,
    pub name:   String,
    pub kind:   String,
    pub addr:   String,
    pub offset: String,
    pub size:   u64,
    pub flags:  String,
}

#[derive(Serialize)]
pub struct ElfSegment {
    pub idx:    usize,
    pub kind:   String,
    pub vaddr:  String,
    pub offset: String,
    pub filesz: u64,
    pub memsz:  u64,
    pub flags:  String,
}

#[derive(Serialize)]
pub struct ElfSymbol {
    pub name:  String,
    pub bind:  String,
    pub kind:  String,
    pub value: String,
    pub size:  u64,
}

#[derive(Serialize)]
pub struct ElfReport {
    pub summary:  ElfSummary,
    pub sections: Vec<ElfSection>,
    pub segments: Vec<ElfSegment>,
    pub symbols:  Vec<ElfSymbol>,
}

fn hex_w(n: u64, w: usize) -> String {
    format!("0x{:0width$X}", n, width = w)
}

fn section_flags(flags: u64) -> String {
    let mut s = String::new();
    if flags & 0x1   != 0 { s.push('W'); }
    if flags & 0x2   != 0 { s.push('A'); }
    if flags & 0x4   != 0 { s.push('X'); }
    if flags & 0x10  != 0 { s.push('M'); }
    if flags & 0x20  != 0 { s.push('S'); }
    if flags & 0x40  != 0 { s.push('I'); }
    if flags & 0x80  != 0 { s.push('L'); }
    if flags & 0x200 != 0 { s.push('G'); }
    if flags & 0x400 != 0 { s.push('T'); }
    s
}

fn segment_flags(f: u32) -> String {
    let mut s = String::new();
    if f & 0x4 != 0 { s.push('R'); }
    if f & 0x2 != 0 { s.push('W'); }
    if f & 0x1 != 0 { s.push('X'); }
    s
}

#[wasm_bindgen]
pub fn parse_elf(bytes: &[u8]) -> Result<JsValue, JsValue> {
    let elf = Elf::parse(bytes).map_err(|e| JsValue::from_str(&format!("{e}")))?;
    let is_64 = elf.is_64;
    let addr_w = if is_64 { 16 } else { 8 };

    let summary = ElfSummary {
        class:   if is_64 { "64-bit" } else { "32-bit" },
        data:    if elf.little_endian { "little-endian" } else { "big-endian" },
        osabi:   osabi_label(elf.header.e_ident[7]),
        kind:    et_label(elf.header.e_type),
        machine: machine_label(elf.header.e_machine),
        entry:   hex_w(elf.header.e_entry, addr_w),
        n_sections: elf.section_headers.len(),
        n_segments: elf.program_headers.len(),
        n_symbols:  elf.syms.iter().count(),
        is_64,
    };

    let shstrtab = &elf.shdr_strtab;
    let sections: Vec<ElfSection> = elf.section_headers.iter().enumerate().map(|(i, sh)| {
        let name = shstrtab.get_at(sh.sh_name).unwrap_or("").to_owned();
        ElfSection {
            idx:    i,
            name,
            kind:   sht_label(sh.sh_type),
            addr:   hex_w(sh.sh_addr,   addr_w),
            offset: hex_w(sh.sh_offset, 8),
            size:   sh.sh_size,
            flags:  section_flags(sh.sh_flags),
        }
    }).collect();

    let segments: Vec<ElfSegment> = elf.program_headers.iter().enumerate().map(|(i, ph)| {
        ElfSegment {
            idx:    i,
            kind:   pt_label(ph.p_type),
            vaddr:  hex_w(ph.p_vaddr,  addr_w),
            offset: hex_w(ph.p_offset, 8),
            filesz: ph.p_filesz,
            memsz:  ph.p_memsz,
            flags:  segment_flags(ph.p_flags),
        }
    }).collect();

    let strtab = &elf.strtab;
    let symbols: Vec<ElfSymbol> = elf.syms.iter().filter_map(|s| {
        let name = strtab.get_at(s.st_name).unwrap_or("");
        if name.is_empty() { return None; }
        Some(ElfSymbol {
            name:  name.to_owned(),
            bind:  stb_label(s.st_bind()),
            kind:  stt_label(s.st_type()),
            value: hex_w(s.st_value, addr_w),
            size:  s.st_size,
        })
    }).collect();

    let report = ElfReport { summary, sections, segments, symbols };
    serde_wasm_bindgen::to_value(&report).map_err(|e| JsValue::from_str(&format!("{e}")))
}

fn et_label(t: u16) -> String {
    match t {
        0 => "NONE", 1 => "REL", 2 => "EXEC", 3 => "DYN", 4 => "CORE",
        _ => return format!("0x{:X}", t),
    }.to_owned()
}

fn machine_label(m: u16) -> String {
    match m {
        0   => "NONE",
        3   => "x86",
        20  => "PowerPC",
        21  => "PowerPC64",
        40  => "ARM",
        62  => "x86_64",
        183 => "AArch64",
        243 => "RISC-V",
        _ => return format!("0x{:X}", m),
    }.to_owned()
}

fn sht_label(t: u32) -> String {
    match t {
        0  => "NULL", 1  => "PROGBITS", 2  => "SYMTAB", 3  => "STRTAB",
        4  => "RELA", 5  => "HASH",     6  => "DYNAMIC", 7  => "NOTE",
        8  => "NOBITS", 9  => "REL",   11 => "DYNSYM",
        14 => "INIT_ARRAY", 15 => "FINI_ARRAY", 16 => "PREINIT_ARRAY",
        17 => "GROUP", 18 => "SYMTAB_SHNDX",
        _  => return format!("0x{:X}", t),
    }.to_owned()
}

fn pt_label(t: u32) -> String {
    match t {
        0 => "NULL", 1 => "LOAD", 2 => "DYNAMIC", 3 => "INTERP", 4 => "NOTE",
        5 => "SHLIB", 6 => "PHDR", 7 => "TLS",
        0x6474e550 => "GNU_EH_FRAME",
        0x6474e551 => "GNU_STACK",
        0x6474e552 => "GNU_RELRO",
        0x6474e553 => "GNU_PROPERTY",
        _ => return format!("0x{:X}", t),
    }.to_owned()
}

fn stb_label(b: u8) -> String {
    match b { 0 => "LOCAL", 1 => "GLOBAL", 2 => "WEAK", _ => return format!("{b}") }.to_owned()
}

fn stt_label(t: u8) -> String {
    match t {
        0 => "NOTYPE", 1 => "OBJECT", 2 => "FUNC", 3 => "SECTION", 4 => "FILE",
        5 => "COMMON", 6 => "TLS", _ => return format!("{t}"),
    }.to_owned()
}

fn osabi_label(b: u8) -> String {
    match b {
        0   => "SYSV",
        1   => "HP-UX",
        2   => "NetBSD",
        3   => "GNU",
        6   => "Solaris",
        7   => "AIX",
        8   => "IRIX",
        9   => "FreeBSD",
        10  => "TRU64",
        11  => "Modesto",
        12  => "OpenBSD",
        64  => "ARM-EABI",
        97  => "ARM",
        255 => "Standalone",
        _ => return format!("0x{:X}", b),
    }.to_owned()
}

/// Cheap "format" sniffer for the landing chip. Returns "elf", "macho", "pe",
/// "wasm", or "raw". Matches the v1 detect.js behavior.
#[wasm_bindgen]
pub fn detect_format(bytes: &[u8]) -> String {
    if bytes.len() < 4 { return "raw".into(); }
    if bytes[0] == 0x7F && bytes[1] == b'E' && bytes[2] == b'L' && bytes[3] == b'F' { return "elf".into(); }
    if bytes[0] == b'M' && bytes[1] == b'Z' { return "pe".into(); }
    if bytes[..4] == [0xCF, 0xFA, 0xED, 0xFE] { return "macho".into(); }
    if bytes[..4] == [0xFE, 0xED, 0xFA, 0xCE] { return "macho".into(); }
    if bytes[..4] == [0xFE, 0xED, 0xFA, 0xCF] { return "macho".into(); }
    if bytes[..4] == [0xCE, 0xFA, 0xED, 0xFE] { return "macho".into(); }
    if bytes[..4] == [0x00, 0x61, 0x73, 0x6D] { return "wasm".into(); }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WAVE" { return "wav".into(); }
    if bytes.len() >= 8 && &bytes[..8] == [0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A] { return "png".into(); }
    // GBA cartridges have no leading magic but every cart's byte 0xB2 is the
    // Nintendo-fixed 0x96 sentinel. Sufficient for landing-page chip
    // detection.
    if bytes.len() >= 0xC0 && bytes[0xB2] == 0x96 { return "gba".into(); }
    "raw".into()
}

#[derive(Serialize)]
pub struct GbaHeader {
    pub title: String,
    pub game_code: String,
    pub maker_code: String,
    pub fixed: u8,
    pub fixed_ok: bool,
    pub unit_code: u8,
    pub device_type: u8,
    pub version: u8,
    pub checksum: u8,
    pub checksum_computed: u8,
    pub checksum_ok: bool,
    pub rom_size: usize,
}

/// Parse the 0xC0-byte GBA cartridge header. The official Nintendo
/// checksum is computed by adding bytes 0xA0..=0xBC, negating, and
/// subtracting 0x19 (per AGB programming manual). We surface both the
/// stored and computed values so the UI can show a verification.
#[wasm_bindgen]
pub fn parse_gba(bytes: &[u8]) -> Result<JsValue, JsValue> {
    if bytes.len() < 0xC0 {
        return Err(JsValue::from_str("too small for GBA header"));
    }
    let ascii_z = |off: usize, len: usize| -> String {
        let mut s = String::with_capacity(len);
        for i in 0..len {
            let b = bytes[off + i];
            if b == 0 { break; }
            if (0x20..=0x7E).contains(&b) { s.push(b as char); } else { s.push('.'); }
        }
        s.trim().to_owned()
    };
    let title = ascii_z(0xA0, 12);
    let game_code = ascii_z(0xAC, 4);
    let maker_code = ascii_z(0xB0, 2);
    let fixed = bytes[0xB2];
    let unit_code = bytes[0xB3];
    let device_type = bytes[0xB4];
    let version = bytes[0xBC];
    let checksum = bytes[0xBD];
    // Spec: sum bytes 0xA0..=0xBC, then computed = -(sum) - 0x19, masked.
    let mut sum: i32 = 0;
    for i in 0xA0..=0xBC { sum = sum.wrapping_add(bytes[i] as i32); }
    let computed = ((-sum - 0x19) & 0xFF) as u8;
    let h = GbaHeader {
        title,
        game_code,
        maker_code,
        fixed,
        fixed_ok: fixed == 0x96,
        unit_code,
        device_type,
        version,
        checksum,
        checksum_computed: computed,
        checksum_ok: computed == checksum,
        rom_size: bytes.len(),
    };
    serde_wasm_bindgen::to_value(&h).map_err(|e| JsValue::from_str(&format!("{e}")))
}

#[derive(Serialize)]
pub struct WavChunk {
    pub id: String,
    pub offset: usize,
    pub size: u32,
}

#[derive(Serialize)]
pub struct WavFmt {
    pub format: u16,
    pub channels: u16,
    pub sample_rate: u32,
    pub byte_rate: u32,
    pub block_align: u16,
    pub bits_per_sample: u16,
}

#[derive(Serialize)]
pub struct WavEnvBin {
    pub min: f32,
    pub max: f32,
    pub rms: f32,
}

#[derive(Serialize)]
pub struct WavReport {
    pub fmt: WavFmt,
    pub chunks: Vec<WavChunk>,
    pub total_frames: u64,
    pub duration: f64,
    pub data_offset: usize,
    pub data_len: u32,
    pub samples: Vec<f32>,     // mono float, channel 0
    pub envelope: Vec<WavEnvBin>,
}

/// Hand-rolled RIFF/WAVE PCM decoder. Returns header chunk catalogue, a peak/
/// RMS envelope across 256 buckets, and the mono Float32 sample buffer (first
/// channel only) for Web Audio playback on the JS side.
#[wasm_bindgen]
pub fn decode_wav(bytes: &[u8]) -> Result<JsValue, JsValue> {
    if bytes.len() < 12 { return Err(JsValue::from_str("WAV too short")); }
    if &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(JsValue::from_str("not a RIFF/WAVE file"));
    }
    let read_u16_le = |o: usize| u16::from_le_bytes([bytes[o], bytes[o+1]]);
    let read_u32_le = |o: usize| u32::from_le_bytes([bytes[o], bytes[o+1], bytes[o+2], bytes[o+3]]);

    let mut fmt: Option<WavFmt> = None;
    let mut data_off: Option<usize> = None;
    let mut data_len: u32 = 0;
    let mut chunks: Vec<WavChunk> = Vec::new();

    let mut off = 12usize;
    while off + 8 <= bytes.len() {
        let id = std::str::from_utf8(&bytes[off..off+4])
            .map_err(|_| JsValue::from_str("bad chunk id"))?
            .to_owned();
        let size = read_u32_le(off + 4);
        chunks.push(WavChunk { id: id.clone(), offset: off, size });
        if id == "fmt " && off + 8 + 16 <= bytes.len() {
            fmt = Some(WavFmt {
                format:           read_u16_le(off + 8),
                channels:         read_u16_le(off + 10),
                sample_rate:      read_u32_le(off + 12),
                byte_rate:        read_u32_le(off + 16),
                block_align:      read_u16_le(off + 20),
                bits_per_sample:  read_u16_le(off + 22),
            });
        } else if id == "data" {
            data_off = Some(off + 8);
            data_len = size;
        }
        // RIFF chunks are word-aligned.
        let advance = 8usize + size as usize + (size & 1) as usize;
        off = off.checked_add(advance).ok_or_else(|| JsValue::from_str("chunk overflow"))?;
    }

    let fmt = fmt.ok_or_else(|| JsValue::from_str("WAV missing fmt chunk"))?;
    let data_off = data_off.ok_or_else(|| JsValue::from_str("WAV missing data chunk"))?;
    if fmt.format != 1 && fmt.format != 3 {
        return Err(JsValue::from_str(&format!("WAV format {} not supported", fmt.format)));
    }
    let bps = fmt.bits_per_sample as usize;
    let block = fmt.block_align as usize;
    if block == 0 { return Err(JsValue::from_str("WAV block_align is zero")); }
    let total_frames = (data_len as usize / block).min((bytes.len() - data_off) / block);
    let mut samples: Vec<f32> = Vec::with_capacity(total_frames);
    for i in 0..total_frames {
        let base = data_off + i * block;
        let v: f32 = match (fmt.format, bps) {
            (3, 32) => {
                let arr = [bytes[base], bytes[base+1], bytes[base+2], bytes[base+3]];
                f32::from_le_bytes(arr)
            }
            (1, 8)  => (bytes[base] as f32 - 128.0) / 128.0,
            (1, 16) => i16::from_le_bytes([bytes[base], bytes[base+1]]) as f32 / 32768.0,
            (1, 24) => {
                let a = bytes[base]   as i32;
                let b = bytes[base+1] as i32;
                let c = bytes[base+2] as i32;
                let mut s = a | (b << 8) | (c << 16);
                if s & 0x800000 != 0 { s |= !0xFFFFFF; }
                s as f32 / 8_388_608.0
            }
            (1, 32) => i32::from_le_bytes([bytes[base], bytes[base+1], bytes[base+2], bytes[base+3]]) as f32 / 2_147_483_648.0,
            _ => 0.0,
        };
        samples.push(v);
    }

    let buckets = 256usize;
    let stride = (samples.len() / buckets).max(1);
    let mut env: Vec<WavEnvBin> = Vec::with_capacity(buckets);
    for b in 0..buckets {
        let start = b * stride;
        let end = ((b + 1) * stride).min(samples.len());
        if start >= end { env.push(WavEnvBin{min:0.0, max:0.0, rms:0.0}); continue; }
        let mut mn = 0f32; let mut mx = 0f32; let mut sq = 0f32; let mut n = 0u32;
        for &s in &samples[start..end] {
            if s < mn { mn = s; }
            if s > mx { mx = s; }
            sq += s * s; n += 1;
        }
        let rms = if n > 0 { (sq / n as f32).sqrt() } else { 0.0 };
        env.push(WavEnvBin { min: mn, max: mx, rms });
    }

    let sr = fmt.sample_rate as f64;
    let report = WavReport {
        fmt,
        chunks,
        total_frames: total_frames as u64,
        duration: if sr > 0.0 { total_frames as f64 / sr } else { 0.0 },
        data_offset: data_off,
        data_len,
        samples,
        envelope: env,
    };
    serde_wasm_bindgen::to_value(&report).map_err(|e| JsValue::from_str(&format!("{e}")))
}

#[derive(Serialize)]
pub struct StringHit {
    pub offset: usize,
    pub text: String,
}

/// Scan `bytes` for runs of printable ASCII (0x20..=0x7E) at least `min_len`
/// long. Returns up to 4096 hits as (offset, text). Useful for surfacing
/// `.rodata` content without a full parser.
#[wasm_bindgen]
pub fn extract_strings(bytes: &[u8], min_len: usize) -> Result<JsValue, JsValue> {
    let min = min_len.max(2);
    const CAP: usize = 4096;
    let mut out: Vec<StringHit> = Vec::new();
    let mut start: Option<usize> = None;
    let mut buf = String::new();
    for (i, &b) in bytes.iter().enumerate() {
        if (0x20..=0x7E).contains(&b) {
            if start.is_none() { start = Some(i); buf.clear(); }
            buf.push(b as char);
        } else if let Some(s) = start.take() {
            if buf.len() >= min {
                out.push(StringHit { offset: s, text: std::mem::take(&mut buf) });
                if out.len() >= CAP { break; }
            }
            buf.clear();
        }
    }
    if let Some(s) = start {
        if buf.len() >= min && out.len() < CAP {
            out.push(StringHit { offset: s, text: buf });
        }
    }
    serde_wasm_bindgen::to_value(&out).map_err(|e| JsValue::from_str(&format!("{e}")))
}

/// Compute normalized Shannon entropy (0.0 .. 1.0) for each block of
/// `block_size` bytes. Useful as a one-row sparkline that highlights packed
/// or encrypted regions vs. plain code / data. 8 bits of entropy = 1.0.
#[wasm_bindgen]
pub fn entropy_blocks(bytes: &[u8], block_size: usize) -> Vec<f32> {
    let bs = block_size.max(64);
    let mut out: Vec<f32> = Vec::with_capacity(bytes.len() / bs + 1);
    let mut i = 0;
    while i < bytes.len() {
        let end = (i + bs).min(bytes.len());
        let block = &bytes[i..end];
        let mut counts = [0u32; 256];
        for &b in block { counts[b as usize] += 1; }
        let n = block.len() as f32;
        let mut h = 0f32;
        for &c in counts.iter() {
            if c > 0 {
                let p = c as f32 / n;
                h -= p * p.log2();
            }
        }
        out.push((h / 8.0).clamp(0.0, 1.0));
        i = end;
    }
    out
}

/// Returns hex+ascii rows for a byte range. Each row is a single string
/// formatted exactly like v1's hex view; the JS side splits and lays out.
#[wasm_bindgen]
pub fn hex_rows(bytes: &[u8], offset: usize, count: usize) -> Vec<JsValue> {
    let end = (offset + count).min(bytes.len());
    let mut out = Vec::with_capacity((end - offset).div_ceil(16));
    let mut i = offset;
    while i < end {
        let row_end = (i + 16).min(end);
        let mut hex = String::with_capacity(48);
        let mut asc = String::with_capacity(16);
        for j in i..row_end {
            let b = bytes[j];
            if j > i { hex.push(' '); }
            hex.push_str(&format!("{:02X}", b));
            asc.push(if (0x20..=0x7E).contains(&b) { b as char } else { '.' });
        }
        let line = format!("{:08X}  {:<47}  {}", i, hex, asc);
        out.push(JsValue::from_str(&line));
        i += 16;
    }
    out
}
