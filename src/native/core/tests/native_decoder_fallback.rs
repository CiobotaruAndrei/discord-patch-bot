use discord_patch_bot_logic::{inspect_untrusted_content, InspectionLimits};

fn raport(bytes: &[u8], nume: &str, mime: &str) -> Vec<String> {
  inspect_untrusted_content(bytes, nume, mime, "content", InspectionLimits::default()).analysis_blind_spots
}

#[test]
fn un_rar_pe_care_decodorul_nativ_nu_il_deschide_e_numarat_pentru_gate_ul_unrar() {
  let mut rar = b"Rar!\x1a\x07\x00".to_vec();
  rar.extend_from_slice(&[0x33u8; 512]);
  let spots = raport(&rar, "arhiva.rar", "application/x-rar-compressed");
  assert!(
    spots.iter().any(|spot| spot.contains("RAR") && spot.contains("decodorul nativ a esuat")),
    "gate-ul UnRAR cere dovada ca libarchive esueaza sistematic; fara numaratoare nu exista dovada: {spots:?}"
  );
}

#[test]
fn un_7z_pe_care_decodorul_nativ_nu_il_deschide_e_numarat_pentru_gate_ul_7zip() {
  let mut seven = vec![0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c];
  seven.extend_from_slice(&[0x11u8; 512]);
  let spots = raport(&seven, "arhiva.7z", "application/x-7z-compressed");
  assert!(
    spots.iter().any(|spot| spot.contains("7z") && spot.contains("decodorul nativ a esuat")),
    "acelasi lucru pentru gate-ul 7-Zip SDK: {spots:?}"
  );
}

#[test]
fn un_zip_obisnuit_nu_raporteaza_esec_de_decodor() {
  let mut zip = b"PK\x03\x04".to_vec();
  zip.extend_from_slice(&[0u8; 64]);
  let spots = raport(&zip, "arhiva.zip", "application/zip");
  assert!(
    !spots.iter().any(|spot| spot.contains("decodorul nativ a esuat")),
    "ZIP-ul are decodor propriu; nu are ce esua: {spots:?}"
  );
}
