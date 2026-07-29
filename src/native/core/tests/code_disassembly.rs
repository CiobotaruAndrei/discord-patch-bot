use discord_patch_bot_logic::{disassemble_code, disassembly_available, DisassemblyLimits, DisassemblyOutcome};

fn raport(cod: &[u8], arhitectura: &str, adresa: u64) -> discord_patch_bot_logic::DisassemblyReport {
  match disassemble_code(cod, arhitectura, adresa, &DisassemblyLimits::default()) {
    DisassemblyOutcome::Analyzed(raport) => raport,
    altceva => panic!("dezasamblarea trebuia sa reuseasca, dar a dat {altceva:?}"),
  }
}

fn indicatori(cod: &[u8], arhitectura: &str, adresa: u64) -> Vec<String> {
  raport(cod, arhitectura, adresa).indicators
}

#[test]
fn motorul_de_dezasamblare_este_compilat() {
  assert!(
    disassembly_available(),
    "fara motorul Capstone tot fisierul asta ar trece degeaba: nu s-ar dezasambla nimic"
  );
}

#[test]
fn citirea_directa_a_peb_este_raportata() {
  let cod = [0x65, 0x48, 0x8b, 0x04, 0x25, 0x60, 0x00, 0x00, 0x00, 0xc3];
  let gasite = indicatori(&cod, "x86-64", 0x1000);
  assert!(
    gasite.iter().any(|indicator| indicator.contains("PEB")),
    "mov rax, gs:[0x60] este exact felul in care codul isi cauta functiile fara tabel de import: {gasite:?}"
  );
}

#[test]
fn apelul_de_sistem_direct_este_raportat() {
  let cod = [0x0f, 0x05, 0xc3];
  let gasite = indicatori(&cod, "x86-64", 0x1000);
  assert!(
    gasite.iter().any(|indicator| indicator.contains("apel de sistem direct")),
    "instructiunea syscall sare peste bibliotecile pe care le urmarim: {gasite:?}"
  );
}

#[test]
fn secventa_call_pop_de_aflare_a_adresei_este_raportata() {
  let cod = [0xe8, 0x00, 0x00, 0x00, 0x00, 0x58, 0xc3];
  let gasite = indicatori(&cod, "x86", 0x1000);
  assert!(
    gasite.iter().any(|indicator| indicator.contains("independent de pozitie")),
    "call catre instructiunea urmatoare urmat de pop este tiparul clasic de shellcode: {gasite:?}"
  );
}

#[test]
fn apelurile_indirecte_prin_registru_sunt_numarate() {
  let mut cod: Vec<u8> = Vec::new();
  for opcode in [0xd0u8, 0xd3, 0xd1, 0xd2, 0xd6, 0xd7, 0xd0, 0xd3] {
    cod.extend_from_slice(&[0xff, opcode]);
  }
  cod.push(0xc3);
  let gasite = indicatori(&cod, "x86-64", 0x1000);
  assert!(
    gasite.iter().any(|indicator| indicator.contains("control indirect")),
    "cand tinta apelurilor se afla abia la rulare, analiza statica de importuri nu vede nimic: {gasite:?}"
  );
}

#[test]
fn bucla_care_isi_rescrie_codul_este_raportata() {
  let cod = [0x80, 0x30, 0x5a, 0x48, 0xff, 0xc0, 0xeb, 0xf8];
  let gasite = indicatori(&cod, "x86-64", 0x1000);
  assert!(
    gasite.iter().any(|indicator| indicator.contains("isi despacheteaza")),
    "xor peste memorie inchis de un salt inapoi este stubul care despacheteaza restul: {gasite:?}"
  );
}

#[test]
fn sirurile_construite_pe_stiva_sunt_raportate() {
  let mut cod: Vec<u8> = Vec::new();
  let bucati: [&[u8; 4]; 6] = [b"Hell", b"o Wo", b"rld!", b"http", b"://x", b".com"];
  for (index, bucata) in bucati.iter().enumerate() {
    let deplasare = (0xf0u8).wrapping_sub((index as u8) * 4);
    cod.extend_from_slice(&[0xc7, 0x45, deplasare]);
    cod.extend_from_slice(*bucata);
  }
  cod.push(0xc3);
  let gasite = indicatori(&cod, "x86-64", 0x1000);
  assert!(
    gasite.iter().any(|indicator| indicator.contains("siruri construite direct pe stiva")),
    "textul scris octet cu octet pe stiva nu apare la o cautare de siruri in fisier: {gasite:?}"
  );
}

#[test]
fn un_prolog_obisnuit_de_functie_nu_produce_indicatori() {
  let cod = [0x55, 0x48, 0x89, 0xe5, 0x31, 0xc0, 0x5d, 0xc3];
  let gasite = indicatori(&cod, "x86-64", 0x1000);
  assert!(
    gasite.is_empty(),
    "cod complet banal nu are voie sa produca alarme, altfel indicatorii devin zgomot: {gasite:?}"
  );
}

#[test]
fn numarul_de_instructiuni_este_plafonat() {
  let limite = DisassemblyLimits::default();
  let cod = vec![0x90u8; limite.max_instructions * 2];
  let rezultat = raport(&cod, "x86-64", 0x1000);
  assert_eq!(
    rezultat.instructions_read, limite.max_instructions,
    "continutul vine de la un expeditor necunoscut, deci dezasamblarea are nevoie de plafon"
  );
  assert!(rezultat.truncated, "cand plafonul se atinge, raportul trebuie sa spuna ca a taiat");
}

#[test]
fn o_arhitectura_pe_care_nu_o_citim_este_spusa_pe_fata() {
  let rezultat = disassemble_code(&[0x13, 0x00, 0x00, 0x00], "RISC-V", 0, &DisassemblyLimits::default());
  assert!(
    matches!(rezultat, DisassemblyOutcome::UnsupportedArchitecture(_)),
    "un rezultat gol ar arata identic cu un fisier curat; diferenta trebuie pastrata: {rezultat:?}"
  );
}

#[test]
fn o_sectiune_goala_nu_este_raportata_drept_curata() {
  let rezultat = disassemble_code(&[], "x86-64", 0, &DisassemblyLimits::default());
  assert!(
    matches!(rezultat, DisassemblyOutcome::Failed(_)),
    "lipsa codului nu inseamna absenta problemelor: {rezultat:?}"
  );
}
