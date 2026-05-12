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
    "raw".into()
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
