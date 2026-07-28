#![cfg(feature = "visual")]

use discord_patch_bot_logic::{
  embedded_jpeg_preview, inspect_untrusted_content, iso_bmff_image_brand, InspectionLimits
};

const QR_PAYLOAD: &str = "https://exemplu.test/heic-phishing";

fn ftyp_box(brand: &[u8; 4], compatible: &[&[u8; 4]]) -> Vec<u8> {
  let mut body = Vec::new();
  body.extend_from_slice(brand);
  body.extend_from_slice(&[0, 0, 0, 0]);
  for entry in compatible {
    body.extend_from_slice(*entry);
  }
  let mut boxed = ((body.len() + 8) as u32).to_be_bytes().to_vec();
  boxed.extend_from_slice(b"ftyp");
  boxed.extend_from_slice(&body);
  boxed
}

fn qr_jpeg() -> Vec<u8> {
  let barcode = zxingcpp::create(zxingcpp::BarcodeFormat::QRCode)
    .from_str(QR_PAYLOAD)
    .expect("codul QR se genereaza");
  let bitmap = barcode
    .to_image_with(&zxingcpp::write().scale(6))
    .expect("bitmap-ul se produce");
  let gray = image::GrayImage::from_raw(bitmap.width() as u32, bitmap.height() as u32, bitmap.data().to_vec())
    .expect("dimensiunile corespund");
  let mut jpeg = Vec::new();
  image::DynamicImage::ImageLuma8(gray)
    .write_to(&mut std::io::Cursor::new(&mut jpeg), image::ImageFormat::Jpeg)
    .expect("JPEG-ul se scrie");
  jpeg
}

fn indicators_for(bytes: &[u8], filename: &str, mime: &str) -> Vec<String> {
  inspect_untrusted_content(bytes, filename, mime, "content", InspectionLimits::default()).indicators
}

#[test]
fn marcile_de_imagine_iso_bmff_sunt_recunoscute_iar_restul_nu() {
  assert_eq!(iso_bmff_image_brand(&ftyp_box(b"heic", &[])), Some("HEIC"));
  assert_eq!(iso_bmff_image_brand(&ftyp_box(b"avif", &[])), Some("AVIF"));
  assert_eq!(iso_bmff_image_brand(&ftyp_box(b"mif1", &[b"heic"])), Some("HEIF"));
  assert_eq!(iso_bmff_image_brand(&ftyp_box(b"isom", &[b"avif"])), Some("AVIF"));
  assert_eq!(iso_bmff_image_brand(&ftyp_box(b"isom", &[b"mp42"])), None, "un container video nu e imagine");
  assert_eq!(iso_bmff_image_brand(b"nu e ftyp deloc, doar octeti"), None);
}

#[test]
fn o_imagine_heic_fara_previzualizare_nu_mai_trece_tacut() {
  let mut heic = ftyp_box(b"heic", &[b"mif1"]);
  heic.extend_from_slice(&vec![0u8; 512]);
  let indicators = indicators_for(&heic, "poza.heic", "image/heic");
  assert!(
    indicators.iter().any(|entry| entry.contains("HEIC") && entry.contains("neinspectata vizual")),
    "un format fara decodor trebuie sa spuna ca nu a fost inspectat, nu sa para curat: {indicators:?}"
  );
}

#[test]
fn un_cod_din_previzualizarea_incorporata_a_unei_imagini_heic_este_citit() {
  let mut heic = ftyp_box(b"heic", &[b"mif1"]);
  heic.extend_from_slice(&qr_jpeg());
  let indicators = indicators_for(&heic, "poza.heic", "image/heic");
  assert!(
    indicators.iter().any(|entry| entry.contains("previzualizarea incorporata")),
    "previzualizarea JPEG dintr-un container HEIC se poate citi fara niciun codec HEVC: {indicators:?}"
  );
  assert!(
    indicators.iter().any(|entry| entry.contains("cod QR")),
    "codul din previzualizare trece prin aceleasi verificari ca orice imagine: {indicators:?}"
  );
}

#[test]
fn extragerea_previzualizarii_respinge_ce_nu_e_jpeg_intreg() {
  assert!(embedded_jpeg_preview(b"fara niciun marcaj jpeg aici", 4096).is_none());
  assert!(embedded_jpeg_preview(&[0xff, 0xd8, 0xff, 0x00, 0x11], 4096).is_none(), "lipseste sfarsitul");
  let mut trunchiat = ftyp_box(b"heic", &[]);
  trunchiat.extend_from_slice(&qr_jpeg()[..40]);
  assert!(embedded_jpeg_preview(&trunchiat, 4096).is_none(), "un JPEG taiat nu e previzualizare valida");
}
