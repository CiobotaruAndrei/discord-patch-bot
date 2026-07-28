use discord_patch_bot_logic::{inspect_untrusted_content, uninspectable_format, InspectionLimits};

fn cu_umplutura(prefix: &[u8], octeti: usize) -> Vec<u8> {
  let mut out = prefix.to_vec();
  out.extend_from_slice(&vec![0x41u8; octeti]);
  out
}

fn ftyp(marca: &[u8; 4]) -> Vec<u8> {
  let mut out = vec![0, 0, 0, 16];
  out.extend_from_slice(b"ftyp");
  out.extend_from_slice(marca);
  out.extend_from_slice(&[0, 0, 0, 0]);
  out
}

fn eticheta_raportata(bytes: &[u8], nume: &str, mime: &str) -> Option<String> {
  inspect_untrusted_content(bytes, nume, mime, "content", InspectionLimits::default()).uninspectable_format
}

#[test]
fn fiecare_gate_din_roadmap_isi_primeste_eticheta_de_format() {
  assert_eq!(uninspectable_format(b"MSCF\0\0\0\0", "x.bin", ""), Some("CAB".to_string()));
  assert_eq!(uninspectable_format(b"ITSF\x03\0\0\0", "x.bin", ""), Some("CHM".to_string()));
  assert_eq!(uninspectable_format(&ftyp(b"heic"), "x.bin", ""), Some("HEIC".to_string()));
  assert_eq!(uninspectable_format(&ftyp(b"avif"), "x.bin", ""), Some("AVIF".to_string()));
  assert_eq!(uninspectable_format(&ftyp(b"mp42"), "x.bin", ""), Some("video ISO-BMFF".to_string()));
  assert_eq!(
    uninspectable_format(&[0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0], "x.bin", ""),
    Some("video Matroska".to_string())
  );
  assert_eq!(uninspectable_format(b"Rar!\x1a\x07\x00", "x.bin", ""), Some("RAR".to_string()));
}

#[test]
fn continutul_pe_care_il_putem_inspecta_nu_primeste_eticheta() {
  assert_eq!(uninspectable_format(b"%PDF-1.4 continut", "a.pdf", "application/pdf"), None);
  assert_eq!(uninspectable_format(b"doar text simplu", "a.txt", "text/plain"), None);
  assert_eq!(uninspectable_format(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "a.png", "image/png"), None);
}

#[test]
fn eticheta_ajunge_in_raport_pentru_formatele_neinspectabile() {
  assert_eq!(eticheta_raportata(&cu_umplutura(b"ITSF\x03\0\0\0", 1024), "ajutor.chm", ""), Some("CHM".to_string()));
  assert_eq!(
    eticheta_raportata(&cu_umplutura(b"MSCF", 512), "document.dat", "application/octet-stream"),
    Some("CAB".to_string()),
    "eticheta nu depinde de numele si MIME-ul declarate de expeditor"
  );
  assert_eq!(eticheta_raportata(&cu_umplutura(&ftyp(b"heic"), 512), "poza.heic", ""), Some("HEIC".to_string()));
  assert_eq!(
    eticheta_raportata(&cu_umplutura(&ftyp(b"mp42"), 512), "clip.mp4", "video/mp4"),
    Some("video ISO-BMFF".to_string()),
    "video-ul nu isi schimba verdictul, dar apare in numaratoare pentru gate-ul FFmpeg"
  );
}

#[test]
fn un_continut_inspectat_normal_nu_raporteaza_niciun_format() {
  let raport = inspect_untrusted_content(b"%PDF-1.4 fara nimic", "a.pdf", "application/pdf", "document", InspectionLimits::default());
  assert_eq!(raport.status, "inspected");
  assert_eq!(raport.uninspectable_format, None, "un fisier inspectat complet nu are ce numara");
}
