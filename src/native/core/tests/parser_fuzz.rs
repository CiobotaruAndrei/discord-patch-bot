use discord_patch_bot_logic::{
  analyze_executable, decode_msi_stream_name, document_indicators, inspect_compound_file_binary, inspect_magic,
  inspect_untrusted_content, scan_visual_codes, ExecutableLimits, InspectionLimits, VisualLimits,
};

struct Xorshift(u64);

impl Xorshift {
  fn next_u64(&mut self) -> u64 {
    let mut x = self.0;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    self.0 = x;
    x
  }

  fn byte(&mut self) -> u8 {
    (self.next_u64() >> 24) as u8
  }

  fn below(&mut self, bound: usize) -> usize {
    if bound == 0 {
      return 0;
    }
    (self.next_u64() % bound as u64) as usize
  }

  fn bytes(&mut self, length: usize) -> Vec<u8> {
    (0..length).map(|_| self.byte()).collect()
  }
}

const HEADERS: &[&[u8]] = &[
  b"PK\x03\x04",
  b"\x1f\x8b\x08",
  b"Rar!\x1a\x07\x00",
  b"Rar!\x1a\x07\x01\x00",
  &[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
  b"%PDF-1.7",
  &[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  &[0x4d, 0x5a, 0x90, 0x00],
  &[0x7f, b'E', b'L', b'F'],
  &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  &[0xff, 0xd8, 0xff, 0xe0],
  b"GIF89a",
];

const MODES: &[&str] = &["archive", "document", "other"];

fn tight_limits() -> InspectionLimits {
  InspectionLimits { max_depth: 2, max_entries: 8, max_expanded_bytes: 64 * 1024, max_compression_ratio: 50.0, timeout_ms: 25 }
}

#[test]
fn motorul_de_inspectie_nu_crapa_pe_continut_aleator_cu_antete_reale() {
  let mut random = Xorshift(0x1357_9bdf_2468_ace0);
  for round in 0..4_000 {
    let header = HEADERS[random.below(HEADERS.len())];
    let mut payload = header.to_vec();
    let extra = random.below(512);
    payload.extend(random.bytes(extra));
    let mode = MODES[random.below(MODES.len())];
    let filename = if round % 3 == 0 { "fisier.exe" } else { "fisier.bin" };
    let report = inspect_untrusted_content(&payload, filename, "application/octet-stream", mode, tight_limits());
    assert!(
      report.status == "inspected" || report.status == "uncertain",
      "verdictul ramane in contract chiar si pe gunoi: {}",
      report.status
    );
  }
}

#[test]
fn parserele_individuale_nu_crapa_pe_octeti_aleatori() {
  let mut random = Xorshift(0x0fed_cba9_8765_4321);
  for _ in 0..4_000 {
    let length = random.below(256);
    let payload = random.bytes(length);
    let _ = inspect_magic(&payload, "x.bin", "application/octet-stream");
    let _ = document_indicators(&payload);
    let _ = inspect_compound_file_binary(&payload);
    let _ = analyze_executable(&payload, &ExecutableLimits::default());
    let _ = scan_visual_codes(&payload, &VisualLimits::default());
  }
}

#[test]
fn un_antet_valid_urmat_de_gunoi_nu_face_parserele_sa_crape() {
  let mut random = Xorshift(0xfeed_face_dead_beef);
  for header in HEADERS {
    for _ in 0..400 {
      let mut payload = header.to_vec();
      let extra = random.below(1024);
      payload.extend(random.bytes(extra));
      let _ = inspect_magic(&payload, "x.bin", "application/octet-stream");
      let _ = inspect_compound_file_binary(&payload);
      let _ = analyze_executable(&payload, &ExecutableLimits::default());
      let _ = scan_visual_codes(&payload, &VisualLimits::default());
      let report = inspect_untrusted_content(&payload, "x.bin", "application/octet-stream", "archive", tight_limits());
      assert!(report.elapsed_ms >= 0.0);
    }
  }
}

#[test]
fn decodarea_numelor_msi_accepta_orice_unitate_utf16_fara_sa_iasa_din_alfabet() {
  let mut random = Xorshift(0x2718_2818_2845_9045);
  for _ in 0..20_000 {
    let length = random.below(24);
    let name: String = (0..length)
      .filter_map(|_| char::from_u32((random.next_u64() % 0x5000) as u32))
      .collect();
    let decoded = decode_msi_stream_name(&name);
    assert!(
      decoded.chars().count() <= name.chars().count() * 2,
      "un code point decodeaza in cel mult doua caractere, deci lungimea nu explodeaza"
    );
  }
}

#[test]
fn continutul_gol_si_cel_de_un_byte_sunt_tratate_ca_orice_alt_continut() {
  for payload in [vec![], vec![0u8], vec![0xffu8]] {
    for mode in MODES {
      let report = inspect_untrusted_content(&payload, "x", "application/octet-stream", mode, tight_limits());
      assert!(report.status == "inspected" || report.status == "uncertain");
    }
    let _ = inspect_magic(&payload, "x", "");
    let _ = analyze_executable(&payload, &ExecutableLimits::default());
    let _ = scan_visual_codes(&payload, &VisualLimits::default());
  }
}
