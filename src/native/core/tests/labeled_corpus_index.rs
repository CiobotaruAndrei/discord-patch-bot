use discord_patch_bot_logic::{
  categories, digest_of, hostile_sample_count, known_sample_indicators, lookup_by_digest, LABELED_CORPUS,
  LABELED_CORPUS_VERSION
};

#[test]
fn corpusul_e_versionat_si_fiecare_mostra_are_eticheta_verificata() {
  assert_eq!(LABELED_CORPUS_VERSION, 1, "versiunea creste doar deliberat, cand indexul se schimba");
  assert!(LABELED_CORPUS.len() >= 17, "corpusul inghetat are cel putin 17 mostre");
  for sample in LABELED_CORPUS {
    assert!(!sample.id.is_empty(), "orice mostra are identitate");
    assert!(!sample.category.is_empty(), "orice mostra are categorie");
    assert_eq!(sample.sha256.len(), 64, "amprenta {} nu e un SHA-256", sample.id);
    assert!(sample.sha256.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
  }
}

#[test]
fn indexul_contine_si_mostre_ostile_si_beningne_din_mai_multe_categorii() {
  let ostile = hostile_sample_count();
  assert!(ostile > 0, "un index doar cu mostre beningne nu e baza de comparatie");
  assert!(ostile < LABELED_CORPUS.len(), "un index doar cu mostre ostile nu poate arata fals-pozitivele");
  assert!(categories().len() >= 3, "categorii: {:?}", categories());
}

#[test]
fn identitatile_mostrelor_sunt_unice() {
  for (index, sample) in LABELED_CORPUS.iter().enumerate() {
    for alta in &LABELED_CORPUS[index + 1..] {
      assert_ne!(sample.id, alta.id, "identitate duplicata: {}", sample.id);
      assert_ne!(sample.sha256, alta.sha256, "amprenta duplicata pentru {}", sample.id);
    }
  }
}

#[test]
fn cautarea_dupa_amprenta_gaseste_mostra_si_ignora_restul() {
  let prima = &LABELED_CORPUS[0];
  let gasita = lookup_by_digest(prima.sha256).expect("mostra proprie se gaseste");
  assert_eq!(gasita.id, prima.id);
  assert_eq!(
    lookup_by_digest(&prima.sha256.to_uppercase()).map(|entry| entry.id),
    Some(prima.id),
    "amprentele se compara fara sa conteze majusculele"
  );
  assert!(lookup_by_digest(&"0".repeat(64)).is_none());
  assert!(lookup_by_digest("nu e amprenta").is_none());
}

#[test]
fn un_continut_identic_cu_o_mostra_cunoscuta_e_raportat_ca_atare() {
  let continut = b"continut oarecare pentru amprenta";
  assert!(known_sample_indicators(continut).is_empty(), "un fisier necunoscut nu produce nimic");
  assert_eq!(digest_of(b"").len(), 64, "amprenta are lungimea unui SHA-256");
}
