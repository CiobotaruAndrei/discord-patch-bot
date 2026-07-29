use discord_patch_bot_logic::{
  container_decode_available, decode_ms_container, ContainerDecodeLimits, ContainerOutcome,
};

const CAB_REAL: [&str; 4] = [
  "4d534346000000009a000000000000002c000000000000000301010001000000000000004b0000000100010048000000",
  "000000000000fd5c00462000696e6361726361746f722e7478740033a9c75547004800434b05c1410a80300c04c0bbaf",
  "d807a8c5ab575f1234c5426943b311fa7b67aede181594802077273cdcb43dc215a571084cf192e6674a26d3e4d85cef",
  "18ba539de9d351f25c7e",
];

fn din_hex(bucati: &[&str]) -> Vec<u8> {
  let text: String = bucati.concat();
  (0..text.len() / 2)
    .map(|index| u8::from_str_radix(&text[index * 2..index * 2 + 2], 16).unwrap())
    .collect()
}

fn cabinet_real() -> Vec<u8> {
  din_hex(&CAB_REAL)
}

fn raport(bytes: &[u8]) -> discord_patch_bot_logic::ContainerReport {
  match decode_ms_container(bytes, &ContainerDecodeLimits::default()) {
    ContainerOutcome::Decoded(raport) => raport,
    altceva => panic!("decodarea trebuia sa reuseasca, dar a dat {altceva:?}"),
  }
}

#[test]
fn decodorul_de_containere_este_compilat() {
  assert!(
    container_decode_available(),
    "fara libmspack testele astea ar trece degeaba: nu s-ar decomprima nimic"
  );
}

#[test]
fn continutul_unui_cab_real_este_decomprimat_nu_doar_listat() {
  let raport = raport(&cabinet_real());
  assert_eq!(raport.format, "CAB");
  assert_eq!(raport.entries.len(), 1, "cabinetul de proba are exact o intrare: {:?}", raport.entries);

  let intrare = &raport.entries[0];
  assert_eq!(intrare.name, "incarcator.txt", "numele intrarii vine din cabinet, nu inventat");
  assert!(
    !intrare.bytes.is_empty(),
    "pana acum continutul comprimat ramanea inchis; daca e tot gol, nu s-a decomprimat nimic"
  );

  let text = String::from_utf8_lossy(&intrare.bytes);
  assert!(
    text.contains("paypa1-secure.test"),
    "adresa era ascunsa in fluxul MSZIP; fara decompresie nu putea fi vazuta: {text:?}"
  );
  assert_eq!(
    intrare.declared_size as usize, intrare.bytes.len(),
    "dimensiunea declarata in cabinet trebuie sa se potriveasca cu ce am scos efectiv"
  );
}

#[test]
fn un_continut_care_nu_e_container_microsoft_e_spus_pe_fata() {
  let rezultat = decode_ms_container(b"%PDF-1.7 document", &ContainerDecodeLimits::default());
  assert!(
    matches!(rezultat, ContainerOutcome::NotContainer),
    "un raport gol ar arata identic cu un container fara intrari: {rezultat:?}"
  );
}

#[test]
fn un_cabinet_trunchiat_raporteaza_esec_cu_motiv_nu_un_raport_inventat() {
  let mut stricat = cabinet_real();
  stricat.truncate(40);
  let rezultat = decode_ms_container(&stricat, &ContainerDecodeLimits::default());
  match rezultat {
    ContainerOutcome::Failed(motiv) => assert!(!motiv.is_empty(), "esecul poarta motivul bibliotecii"),
    ContainerOutcome::Decoded(raport) => assert!(
      raport.truncated || raport.entries.is_empty(),
      "un cabinet taiat nu are voie sa produca intrari complete fara semn de trunchiere"
    ),
    altceva => panic!("asteptam esec sau raport marcat trunchiat, am primit {altceva:?}"),
  }
}

#[test]
fn plafonul_pe_intrare_opreste_o_bomba_de_decompresie() {
  let limite = ContainerDecodeLimits { max_entry_bytes: 8, ..ContainerDecodeLimits::default() };
  let rezultat = decode_ms_container(&cabinet_real(), &limite);
  let ContainerOutcome::Decoded(raport) = rezultat else {
    panic!("cabinetul e valid, deci trebuie decodat chiar si sub plafon");
  };
  let intrare = &raport.entries[0];
  assert!(intrare.bytes.len() <= 8, "plafonul trebuie respectat, altfel un fisier mic poate umple memoria");
  assert!(
    intrare.truncated,
    "cand plafonul taie continutul, raportul trebuie sa spuna; altfel restul analizei crede ca a vazut tot"
  );
}

#[test]
fn plafonul_pe_numarul_de_intrari_este_respectat() {
  let limite = ContainerDecodeLimits { max_entries: 0, ..ContainerDecodeLimits::default() };
  let ContainerOutcome::Decoded(raport) = decode_ms_container(&cabinet_real(), &limite) else {
    panic!("cabinetul e valid");
  };
  assert!(raport.entries.is_empty());
  assert!(raport.truncated, "oprirea la plafon trebuie sa fie vizibila in raport");
}

#[test]
fn un_cab_cu_adresa_de_phishing_nu_mai_iese_neconfirmat() {
  use discord_patch_bot_logic::{inspect_untrusted_content, InspectionLimits};

  let raport = inspect_untrusted_content(
    &cabinet_real(),
    "actualizare.cab",
    "application/octet-stream",
    "auto",
    InspectionLimits::default(),
  );

  assert_eq!(
    raport.status, "inspected",
    "pana acum un CAB iesea mereu neconfirmat fiindca nu putea fi deschis; acum continutul chiar e citit: {:?}",
    raport.indicators
  );
  assert!(
    raport.indicators.iter().any(|indicator| indicator.contains("paypa1-secure.test")),
    "adresa statea in fluxul comprimat; fara decompresie raportul o rata complet: {:?}",
    raport.indicators
  );
}
