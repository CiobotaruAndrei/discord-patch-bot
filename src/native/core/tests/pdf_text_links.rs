use discord_patch_bot_logic::{inspect_untrusted_content, InspectionLimits};
use flate2::write::ZlibEncoder;
use flate2::Compression;
use std::io::Write;

fn pdf_cu_text(continut: &[u8]) -> Vec<u8> {
  let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
  encoder.write_all(continut).expect("compresia reuseste");
  let flux = encoder.finish().expect("fluxul se inchide");

  let mut pdf = b"%PDF-1.4\n1 0 obj\n".to_vec();
  pdf.extend_from_slice(format!("<< /Filter /FlateDecode /Length {} >>\nstream\n", flux.len()).as_bytes());
  pdf.extend_from_slice(&flux);
  pdf.extend_from_slice(b"\nendstream\nendobj\ntrailer\n<< /Size 2 /Root 1 0 R >>\n%%EOF\n");
  pdf
}

fn indicatori(continut: &[u8]) -> Vec<String> {
  inspect_untrusted_content(&pdf_cu_text(continut), "factura.pdf", "application/pdf", "document", InspectionLimits::default())
    .indicators
}

#[test]
fn o_adresa_din_textul_vizibil_al_unui_pdf_nu_mai_trece_neobservata() {
  let found = indicatori(b"BT /F1 12 Tf (Contul tau a fost suspendat. Intra pe https://paypa1-secure.test/verify) Tj ET");
  assert!(
    found.iter().any(|entry| entry.contains("paypa1-secure.test")),
    "textul vizibil e chiar mesajul de phishing; nu are nevoie de OCR ca sa fie citit: {found:?}"
  );
}

#[test]
fn adresele_scrise_hexazecimal_sunt_tratate_la_fel() {
  let hexa = "68747470733a2f2f62616e63612d66616c73612e746573742f78";
  let found = indicatori(format!("BT <{hexa}> Tj ET").as_bytes());
  assert!(
    found.iter().any(|entry| entry.contains("banca-falsa.test")),
    "un sir hexazecimal e tot text vizibil dupa randare: {found:?}"
  );
}

#[test]
fn un_document_fara_adrese_ramane_fara_indicatori_de_link() {
  let found = indicatori(b"BT /F1 12 Tf (Raport trimestrial, fara nicio adresa) Tj ET");
  assert!(
    !found.iter().any(|entry| entry.contains("link in textul vizibil")),
    "fara adrese nu se raporteaza nimic, ca sa nu se umple raportul de zgomot: {found:?}"
  );
}

#[test]
fn aceeasi_gazda_repetata_nu_produce_indicatori_duplicati() {
  let found = indicatori(
    b"BT (mergi pe https://exemplu.test/a) Tj (sau pe https://exemplu.test/b) Tj ET"
  );
  let repetari = found.iter().filter(|entry| entry.contains("exemplu.test")).count();
  assert_eq!(repetari, 1, "gazda se raporteaza o singura data: {found:?}");
}
