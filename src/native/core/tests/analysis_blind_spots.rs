use discord_patch_bot_logic::{analysis_blind_spots, ExecutableReport, ExecutableSection};

fn sectiune(nume: &str, raw_size: u64, entropy: f64, executable: bool) -> ExecutableSection {
  ExecutableSection {
    name: nume.to_string(),
    raw_size,
    virtual_size: raw_size,
    entropy,
    executable,
    writable: false
  }
}

fn raport(sections: Vec<ExecutableSection>, imports: Vec<String>, indicators: Vec<String>) -> ExecutableReport {
  ExecutableReport {
    format: "PE".to_string(),
    architecture: "x86_64".to_string(),
    entry_point: 0x1000,
    is_library: false,
    sections,
    imported_libraries: imports,
    indicators,
    signed: false,
    overlay_bytes: 0,
    truncated: false
  }
}

#[test]
fn codul_fara_importuri_rezolvabile_e_un_punct_orb() {
  let spots = analysis_blind_spots(&raport(
    vec![sectiune(".text", 65536, 6.1, true)],
    Vec::new(),
    vec!["sectiune scrisa si executabila".to_string()]
  ));
  assert!(
    spots.iter().any(|spot| spot.contains("fara importuri rezolvabile")),
    "o tabela de importuri goala peste cod real inseamna rezolvare dinamica de API, exact ce ar citi Capstone: {spots:?}"
  );
}

#[test]
fn importurile_prezente_inseamna_ca_stim_ce_apeleaza() {
  let spots = analysis_blind_spots(&raport(
    vec![sectiune(".text", 65536, 6.1, true)],
    vec!["kernel32.dll".to_string()],
    vec!["import cu risc".to_string()]
  ));
  assert!(!spots.iter().any(|spot| spot.contains("fara importuri rezolvabile")));
}

#[test]
fn entropia_de_impachetare_fara_packer_cunoscut_e_un_punct_orb() {
  let necunoscut = analysis_blind_spots(&raport(
    vec![sectiune(".text", 65536, 7.6, true)],
    vec!["kernel32.dll".to_string()],
    vec!["entropie ridicata".to_string()]
  ));
  assert!(necunoscut.iter().any(|spot| spot.contains("fara packer cunoscut")));

  let cunoscut = analysis_blind_spots(&raport(
    vec![sectiune(".text", 65536, 7.6, true)],
    vec!["kernel32.dll".to_string()],
    vec!["impachetat cu UPX".to_string()]
  ));
  assert!(
    !cunoscut.iter().any(|spot| spot.contains("fara packer cunoscut")),
    "cand packerul e recunoscut, nu mai e un punct orb: {cunoscut:?}"
  );
}

#[test]
fn un_executabil_fara_niciun_indicator_ramane_populatia_pe_care_o_tinteste_capstone() {
  let spots = analysis_blind_spots(&raport(
    vec![sectiune(".text", 65536, 6.0, true)],
    vec!["kernel32.dll".to_string()],
    Vec::new()
  ));
  assert!(spots.iter().any(|spot| spot.contains("fara niciun indicator structural")));
}

#[test]
fn un_binar_minuscul_sau_o_biblioteca_fara_cod_nu_produc_zgomot() {
  let mic = analysis_blind_spots(&raport(vec![sectiune(".text", 128, 6.0, true)], Vec::new(), Vec::new()));
  assert!(mic.is_empty(), "sub pragul de cod semnificativ nu raportam nimic: {mic:?}");

  let fara_cod = analysis_blind_spots(&raport(vec![sectiune(".data", 65536, 7.9, false)], Vec::new(), Vec::new()));
  assert!(fara_cod.is_empty(), "entropia dintr-o sectiune de date nu e semnal de impachetare de cod: {fara_cod:?}");
}
