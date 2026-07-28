use discord_patch_bot_logic::{container_signature, inspect_untrusted_content, InspectionLimits};

fn cu_umplutura(prefix: &[u8], octeti: usize) -> Vec<u8> {
  let mut out = prefix.to_vec();
  out.extend_from_slice(&vec![0x41u8; octeti]);
  out
}

fn status_pentru(bytes: &[u8], nume: &str, mime: &str) -> String {
  inspect_untrusted_content(bytes, nume, mime, "content", InspectionLimits::default()).status
}

#[test]
fn semnaturile_containerelor_sunt_recunoscute_dupa_octeti() {
  assert_eq!(container_signature(b"MSCF\0\0\0\0"), Some("CAB"));
  assert_eq!(container_signature(b"ITSF\x03\0\0\0"), Some("CHM"));
  assert_eq!(container_signature(&[0x53, 0x5a, 0x44, 0x44, 0x88, 0xf0, 0x27, 0x33]), Some("SZDD"));
  assert_eq!(container_signature(&[0x4b, 0x57, 0x41, 0x4a, 0x88, 0xf0, 0x27, 0xd1]), Some("KWAJ"));
  assert_eq!(container_signature(&[0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]), Some("XZ"));
  assert_eq!(container_signature(&[0x28, 0xb5, 0x2f, 0xfd, 0x00]), Some("Zstandard"));
  assert_eq!(container_signature(b"BZh9abcd"), Some("bzip2"));
}

#[test]
fn continutul_obisnuit_nu_e_confundat_cu_un_container() {
  assert_eq!(container_signature(b"BZh0nu e valid"), None, "nivelul 0 nu exista la bzip2");
  assert_eq!(container_signature(b"BZhx"), None, "dupa BZh trebuie o cifra");
  assert_eq!(container_signature(b"MSC"), None, "semnatura trunchiata");
  assert_eq!(container_signature(b"un text oarecare"), None);
  assert_eq!(container_signature(b""), None);
}

#[test]
fn un_container_fara_decodor_nu_mai_e_raportat_ca_inspectat_curat() {
  let chm = cu_umplutura(b"ITSF\x03\0\0\0", 2048);
  assert_eq!(
    status_pentru(&chm, "ajutor.chm", "application/vnd.ms-htmlhelp"),
    "uncertain",
    "CHM e un vector cunoscut de malware; a raporta inspected fara indicatori inseamna a-l declara curat"
  );

  let szdd = cu_umplutura(&[0x53, 0x5a, 0x44, 0x44, 0x88, 0xf0, 0x27, 0x33], 256);
  assert_eq!(status_pentru(&szdd, "vechi.ex_", "application/octet-stream"), "uncertain");
}

#[test]
fn recunoasterea_nu_depinde_de_numele_sau_mime_ul_declarat_de_expeditor() {
  let cab = cu_umplutura(b"MSCF", 512);

  assert_eq!(
    status_pentru(&cab, "pachet.cab", "application/vnd.ms-cab-compressed"),
    "uncertain",
    "cu MIME-ul corect era deja prins"
  );
  assert_eq!(
    status_pentru(&cab, "document.dat", "application/octet-stream"),
    "uncertain",
    "aceiasi octeti, redenumiti si cu MIME generic, treceau inainte ca inspectati si curati; \
     detectia nu are voie sa depinda de metadate alese de expeditor"
  );
}
