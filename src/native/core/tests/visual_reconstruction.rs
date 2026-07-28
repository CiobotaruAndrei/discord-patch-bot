#![cfg(feature = "visual")]

use discord_patch_bot_logic::{png_from_samples, scan_visual_codes, VisualLimits, VisualOutcome};

const QR_PAYLOAD: &str = "https://exemplu.test/plata-urgenta";

fn qr_grayscale() -> (u32, u32, Vec<u8>) {
  let barcode = zxingcpp::create(zxingcpp::BarcodeFormat::QRCode)
    .from_str(QR_PAYLOAD)
    .expect("codul QR se genereaza");
  let bitmap = barcode
    .to_image_with(&zxingcpp::write().scale(4))
    .expect("bitmap-ul se produce");
  (bitmap.width() as u32, bitmap.height() as u32, bitmap.data().to_vec())
}

#[test]
fn un_bitmap_reconstruit_din_esantioane_brute_e_decodat_ca_orice_imagine() {
  let (width, height, gray) = qr_grayscale();
  let png = png_from_samples(width, height, 1, &gray).expect("PNG-ul se reconstruieste din esantioane");

  match scan_visual_codes(&png, &VisualLimits::default()) {
    VisualOutcome::Scanned { codes, .. } => {
      let payloads: Vec<&str> = codes.iter().map(|code| code.payload.as_str()).collect();
      assert!(
        payloads.contains(&QR_PAYLOAD),
        "esantioanele brute dintr-un XObject de imagine PDF nu au antet de container; reconstructia \
         bitmap-ului e singurul pas care lipsea, si el nu are nevoie de PDFium. Payload-uri: {payloads:?}"
      );
    }
    VisualOutcome::Failed(reason) => panic!("scanare esuata: {reason}"),
    VisualOutcome::Unavailable(reason) => panic!("scanare indisponibila: {reason}"),
    VisualOutcome::NotImage => panic!("PNG-ul reconstruit nu e recunoscut ca imagine")
  }
}

#[test]
fn reconstructia_respinge_esantioanele_care_nu_se_potrivesc_cu_dimensiunile() {
  let (width, height, gray) = qr_grayscale();
  assert!(png_from_samples(width, height, 3, &gray).is_none(), "numar gresit de canale");
  assert!(png_from_samples(width + 1, height, 1, &gray).is_none(), "latime gresita");
  assert!(png_from_samples(0, height, 1, &gray).is_none(), "latime zero");
  assert!(png_from_samples(width, height, 2, &gray).is_none(), "canale nesuportate");
}
