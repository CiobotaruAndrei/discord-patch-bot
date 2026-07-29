use discord_patch_bot_logic::{inspect_untrusted_content, InspectionLimits};
use flate2::write::DeflateEncoder;
use flate2::Compression;
use std::io::Write;

fn zip_cu_intrare(name: &str, payload: &[u8]) -> Vec<u8> {
  let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
  encoder.write_all(payload).expect("compresia reuseste");
  let comprimat = encoder.finish().expect("fluxul se inchide");
  let mut crc = flate2::Crc::new();
  crc.update(payload);
  let suma = crc.sum().to_le_bytes();
  let marime_comprimata = (comprimat.len() as u32).to_le_bytes();
  let marime = (payload.len() as u32).to_le_bytes();
  let lungime_nume = (name.len() as u16).to_le_bytes();

  let mut local = b"PK\x03\x04".to_vec();
  local.extend_from_slice(&[20, 0, 0, 0, 8, 0, 0, 0, 0, 0]);
  local.extend_from_slice(&suma);
  local.extend_from_slice(&marime_comprimata);
  local.extend_from_slice(&marime);
  local.extend_from_slice(&lungime_nume);
  local.extend_from_slice(&[0, 0]);
  local.extend_from_slice(name.as_bytes());
  local.extend_from_slice(&comprimat);

  let mut central = b"PK\x01\x02".to_vec();
  central.extend_from_slice(&[20, 0, 20, 0, 0, 0, 8, 0, 0, 0, 0, 0]);
  central.extend_from_slice(&suma);
  central.extend_from_slice(&marime_comprimata);
  central.extend_from_slice(&marime);
  central.extend_from_slice(&lungime_nume);
  central.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  central.extend_from_slice(name.as_bytes());

  let mut zip = local.clone();
  let offset_central = (zip.len() as u32).to_le_bytes();
  let lungime_central = (central.len() as u32).to_le_bytes();
  zip.extend_from_slice(&central);
  zip.extend_from_slice(b"PK\x05\x06");
  zip.extend_from_slice(&[0, 0, 0, 0, 1, 0, 1, 0]);
  zip.extend_from_slice(&lungime_central);
  zip.extend_from_slice(&offset_central);
  zip.extend_from_slice(&[0, 0]);
  zip
}

fn indicatori(bytes: &[u8], nume: &str, mime: &str) -> Vec<String> {
  inspect_untrusted_content(bytes, nume, mime, "content", InspectionLimits::default()).indicators
}

#[test]
fn un_docx_cu_adresa_de_phishing_in_text_nu_mai_trece_curat() {
  let document = br#"<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>Contul e suspendat, intra pe https://paypa1-secure.test/verify</w:t></w:r></w:p></w:body></w:document>"#;
  let docx = zip_cu_intrare("word/document.xml", document);
  let found = indicatori(
    &docx,
    "factura.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  assert!(
    found.iter().any(|entry| entry.contains("paypa1-secure.test")),
    "un document Office e o arhiva cu text; adresa din el trebuie citita ca oriunde altundeva: {found:?}"
  );
}

#[test]
fn un_html_trimis_direct_e_tratat_la_fel() {
  let html = b"<html><body>Contul e suspendat, intra pe https://banca-falsa.test/login</body></html>";
  let found = indicatori(html, "mesaj.html", "text/html");
  assert!(
    found.iter().any(|entry| entry.contains("banca-falsa.test")),
    "HTML-ul trimis direct nu trece prin calea de arhiva, deci are nevoie de propria acoperire: {found:?}"
  );
}

#[test]
fn un_document_fara_adrese_nu_produce_indicatori_de_link() {
  let curat = zip_cu_intrare("word/document.xml", b"<w:t>Raport trimestrial, fara adrese</w:t>");
  let found = indicatori(&curat, "raport.docx", "application/zip");
  assert!(
    !found.iter().any(|entry| entry.contains("link in textul documentului")),
    "fara adrese nu se raporteaza nimic: {found:?}"
  );
}

#[test]
fn continutul_binar_fara_text_nu_declanseaza_cautarea() {
  let binar: Vec<u8> = (0..4096u32).map(|index| (index % 251) as u8).collect();
  let found = indicatori(&binar, "date.bin", "application/octet-stream");
  assert!(!found.iter().any(|entry| entry.contains("link in textul documentului")), "{found:?}");
}
