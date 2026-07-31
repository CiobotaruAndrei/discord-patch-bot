use native_inspector::protocol::{read_request, read_response, write_request, InspectionRequest, MAX_FRAME_BYTES};

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
}

fn sample_request() -> InspectionRequest {
  InspectionRequest {
    filename: "arhiva.zip".to_string(),
    mime: "application/zip".to_string(),
    mode: "archive".to_string(),
    max_depth: 3,
    max_entries: 64,
    max_expanded_bytes: 8 * 1024 * 1024,
    max_compression_ratio: 100.0,
    timeout_ms: 100,
    content: b"PK\x03\x04 continut de test".to_vec(),
  }
}

#[test]
fn octetii_aleatori_nu_produc_niciodata_panica_la_citirea_unei_cereri() {
  let mut random = Xorshift(0x2f6e_2b1c_9d4a_7e35);
  for _ in 0..20_000 {
    let length = random.below(96);
    let frame: Vec<u8> = (0..length).map(|_| random.byte()).collect();
    let _ = read_request(&mut frame.as_slice());
  }
}

#[test]
fn octetii_aleatori_dupa_o_semnatura_valida_nu_produc_panica() {
  let mut random = Xorshift(0x91a3_c7f2_5b8d_0e46);
  for _ in 0..20_000 {
    let mut frame = b"DPBI".to_vec();
    let length = random.below(128);
    frame.extend((0..length).map(|_| random.byte()));
    let _ = read_request(&mut frame.as_slice());
  }
}

#[test]
fn un_cadru_valid_mutat_bit_cu_bit_este_respins_sau_citit_dar_niciodata_nu_crapa() {
  let mut buffer = Vec::new();
  write_request(&mut buffer, &sample_request()).expect("cadrul de referinta se scrie");
  let mut random = Xorshift(0x5c1d_88a4_31f7_20be);

  for _ in 0..20_000 {
    let mut mutated = buffer.clone();
    let flips = 1 + random.below(4);
    for _ in 0..flips {
      let index = random.below(mutated.len());
      let bit = random.below(8);
      mutated[index] ^= 1u8 << bit;
    }
    let _ = read_request(&mut mutated.as_slice());
  }
}

#[test]
fn un_cadru_valid_trunchiat_la_orice_lungime_nu_produce_panica() {
  let mut buffer = Vec::new();
  write_request(&mut buffer, &sample_request()).expect("cadrul de referinta se scrie");
  for length in 0..buffer.len() {
    let _ = read_request(&mut &buffer[..length]);
  }
}

#[test]
fn o_lungime_de_continut_absurda_este_respinsa_fara_alocare() {
  let mut frame = b"DPBI".to_vec();
  frame.extend_from_slice(&1u16.to_le_bytes());
  for text in ["a", "b", "c"] {
    frame.extend_from_slice(&(text.len() as u32).to_le_bytes());
    frame.extend_from_slice(text.as_bytes());
  }
  frame.extend_from_slice(&3u32.to_le_bytes());
  frame.extend_from_slice(&64u32.to_le_bytes());
  frame.extend_from_slice(&1024u64.to_le_bytes());
  frame.extend_from_slice(&100u64.to_le_bytes());
  frame.extend_from_slice(&u64::MAX.to_le_bytes());

  let error = read_request(&mut frame.as_slice()).unwrap_err();
  assert_eq!(error.kind(), std::io::ErrorKind::InvalidData, "u64::MAX bytes nu se aloca, se respinge");
  assert_eq!(MAX_FRAME_BYTES, 64 * 1024 * 1024, "plafonul de cadru ramane cel documentat");
}

#[test]
fn raspunsurile_aleatorii_nu_produc_panica_la_decodare() {
  let mut random = Xorshift(0xa7e4_1f09_6c23_bd58);
  for _ in 0..20_000 {
    let mut frame = b"DPBO".to_vec();
    let length = random.below(128);
    frame.extend((0..length).map(|_| random.byte()));
    let _ = read_response(&mut frame.as_slice());
  }
}
