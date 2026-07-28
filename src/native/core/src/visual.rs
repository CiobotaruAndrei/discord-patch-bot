pub struct VisualLimits {
  pub max_pixels: u64,
  pub max_dimension: u32,
  pub max_codes: usize,
  pub max_payload_bytes: usize,
}

impl Default for VisualLimits {
  fn default() -> Self {
    Self { max_pixels: 16_000_000, max_dimension: 8_000, max_codes: 8, max_payload_bytes: 2_048 }
  }
}

pub struct VisualCode {
  pub payload: String,
  pub looks_like_url: bool,
}

pub enum VisualOutcome {
  Unavailable(String),
  NotImage,
  Failed(String),
  Scanned { codes: Vec<VisualCode>, indicators: Vec<String> },
}

pub fn visual_analysis_available() -> bool {
  cfg!(feature = "visual")
}

pub fn looks_like_image(bytes: &[u8]) -> bool {
  if bytes.len() < 8 {
    return false;
  }
  let png = bytes.starts_with(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let jpeg = bytes.starts_with(&[0xff, 0xd8, 0xff]);
  let gif = bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a");
  let bmp = bytes.starts_with(b"BM");
  let webp = bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP";
  png || jpeg || gif || bmp || webp
}

pub fn payload_looks_like_url(payload: &str) -> bool {
  let lower = payload.trim().to_lowercase();
  lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("ftp://")
}

#[cfg(feature = "visual")]
fn describe_format(format: zxingcpp::BarcodeFormat) -> &'static str {
  use zxingcpp::BarcodeFormat;
  match format {
    BarcodeFormat::QRCode | BarcodeFormat::MicroQRCode | BarcodeFormat::RMQRCode => "cod QR",
    BarcodeFormat::DataMatrix => "cod DataMatrix",
    BarcodeFormat::Aztec => "cod Aztec",
    BarcodeFormat::PDF417 => "cod PDF417",
    BarcodeFormat::MaxiCode => "cod MaxiCode",
    _ => "cod de bare",
  }
}

#[cfg(feature = "visual")]
mod engine {
  use super::*;
  use super::describe_format;
  use image::ImageReader;
  use std::io::Cursor;

  pub fn scan(bytes: &[u8], limits: &VisualLimits) -> VisualOutcome {
    if !looks_like_image(bytes) {
      return VisualOutcome::NotImage;
    }
    let reader = match ImageReader::new(Cursor::new(bytes)).with_guessed_format() {
      Ok(reader) => reader,
      Err(error) => return VisualOutcome::Failed(error.to_string()),
    };
    let dimensions = match reader.into_dimensions() {
      Ok(dimensions) => dimensions,
      Err(error) => return VisualOutcome::Failed(error.to_string()),
    };
    if dimensions.0 > limits.max_dimension || dimensions.1 > limits.max_dimension {
      return VisualOutcome::Failed(format!(
        "imaginea depaseste plafonul de {} pixeli pe o latura",
        limits.max_dimension
      ));
    }
    if u64::from(dimensions.0) * u64::from(dimensions.1) > limits.max_pixels {
      return VisualOutcome::Failed(format!("imaginea depaseste plafonul de {} pixeli", limits.max_pixels));
    }

    let decoded = match ImageReader::new(Cursor::new(bytes)).with_guessed_format() {
      Ok(reader) => match reader.decode() {
        Ok(image) => image,
        Err(error) => return VisualOutcome::Failed(error.to_string()),
      },
      Err(error) => return VisualOutcome::Failed(error.to_string()),
    };

    let luma = decoded.to_luma8();
    let view = match zxingcpp::ImageView::from_slice(
      luma.as_raw(),
      luma.width(),
      luma.height(),
      zxingcpp::ImageFormat::Lum,
    ) {
      Ok(view) => view,
      Err(error) => return VisualOutcome::Failed(format!("imaginea nu a putut fi pregatita pentru decodare: {}", error)),
    };

    let reader = zxingcpp::BarcodeReader::new()
      .try_harder(true)
      .try_rotate(true)
      .try_invert(true)
      .max_number_of_symbols(limits.max_codes as i32 + 1);
    let barcodes = match reader.from(&view) {
      Ok(barcodes) => barcodes,
      Err(error) => return VisualOutcome::Failed(format!("decodarea codurilor a esuat: {}", error)),
    };

    let valid: Vec<&zxingcpp::Barcode> = barcodes.iter().filter(|barcode| barcode.is_valid()).collect();
    let mut codes: Vec<VisualCode> = Vec::new();
    let mut indicators: Vec<String> = Vec::new();

    for barcode in valid.iter().take(limits.max_codes) {
      let mut payload = barcode.text();
      payload.truncate(limits.max_payload_bytes);
      let looks_like_url = payload_looks_like_url(&payload);
      let symbology = describe_format(barcode.format());
      if looks_like_url {
        indicators.push(format!("{} care contine un link", symbology));
      } else {
        indicators.push(format!("{} in imagine", symbology));
      }
      codes.push(VisualCode { payload, looks_like_url });
    }
    if valid.len() > limits.max_codes {
      indicators.push(format!("imaginea contine mai mult de {} coduri; restul nu au fost citite", limits.max_codes));
    }

    let mut deduped: Vec<String> = Vec::new();
    for indicator in indicators {
      if !deduped.contains(&indicator) {
        deduped.push(indicator);
      }
    }
    VisualOutcome::Scanned { codes, indicators: deduped }
  }
}

#[cfg(not(feature = "visual"))]
mod engine {
  use super::*;

  pub fn scan(bytes: &[u8], _limits: &VisualLimits) -> VisualOutcome {
    if !looks_like_image(bytes) {
      return VisualOutcome::NotImage;
    }
    VisualOutcome::Unavailable(
      "analiza vizuala nu este compilata in acest build (feature `visual` dezactivat)".to_string(),
    )
  }
}

pub fn scan_visual_codes(bytes: &[u8], limits: &VisualLimits) -> VisualOutcome {
  engine::scan(bytes, limits)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn detectia_de_imagine_acopera_formatele_uzuale_si_respinge_restul() {
    assert!(looks_like_image(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    assert!(looks_like_image(&[0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]));
    assert!(looks_like_image(b"GIF89a__"));
    assert!(!looks_like_image(b"%PDF-1.7"));
    assert!(!looks_like_image(b"PK\x03\x04____"));
    assert!(!looks_like_image(b""));
  }

  #[test]
  fn un_continut_care_nu_e_imagine_nu_e_tratat_ca_esec() {
    let outcome = scan_visual_codes(b"%PDF-1.7 document", &VisualLimits::default());
    assert!(matches!(outcome, VisualOutcome::NotImage));
  }

  #[test]
  fn payload_ul_de_link_e_recunoscut_dar_textul_obisnuit_nu() {
    assert!(payload_looks_like_url("https://example.com/a"));
    assert!(payload_looks_like_url("  HTTP://EXAMPLE.COM  "));
    assert!(!payload_looks_like_url("doar un text"));
    assert!(!payload_looks_like_url("javascript:alert(1)"));
  }

  #[cfg(feature = "visual")]
  fn render_barcode(format: zxingcpp::BarcodeFormat, payload: &str) -> image::GrayImage {
    let barcode = zxingcpp::BarcodeCreator::new(format).from_str(payload).expect("codul se genereaza");
    let bitmap = barcode
      .to_image_with(&zxingcpp::BarcodeWriter::new().scale(4))
      .expect("codul se randeaza");
    let width = bitmap.width() as u32;
    let height = bitmap.height() as u32;
    image::GrayImage::from_raw(width, height, bitmap.data()).expect("dimensiunile corespund")
  }

  #[cfg(feature = "visual")]
  fn png_of(image: &image::GrayImage) -> Vec<u8> {
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageLuma8(image.clone())
      .write_to(&mut out, image::ImageFormat::Png)
      .expect("PNG-ul se codifica");
    out.into_inner()
  }

  #[cfg(feature = "visual")]
  #[test]
  fn formatele_pe_care_un_decodor_doar_qr_nu_le_putea_citi_sunt_acum_decodate() {
    for (format, payload) in [
      (zxingcpp::BarcodeFormat::DataMatrix, "https://exemplu.test/datamatrix"),
      (zxingcpp::BarcodeFormat::Aztec, "https://exemplu.test/aztec"),
      (zxingcpp::BarcodeFormat::PDF417, "https://exemplu.test/pdf417"),
    ] {
      let bytes = png_of(&render_barcode(format, payload));
      match scan_visual_codes(&bytes, &VisualLimits::default()) {
        VisualOutcome::Scanned { codes, indicators } => {
          assert_eq!(codes.len(), 1, "{:?} produce exact un cod decodat", format);
          assert_eq!(codes[0].payload, payload, "payload-ul {:?} e citit integral", format);
          assert!(codes[0].looks_like_url, "payload-ul e recunoscut ca link");
          assert!(
            indicators.iter().any(|value| value.contains("care contine un link")),
            "indicatorul spune ca e un link: {:?}",
            indicators
          );
        }
        other => panic!(
          "{:?} trebuie decodat; un decodor doar-QR il rata complet ({})",
          format,
          match other {
            VisualOutcome::NotImage => "NotImage".to_string(),
            VisualOutcome::Failed(detail) => detail,
            VisualOutcome::Unavailable(detail) => detail,
            _ => "altceva".to_string(),
          }
        ),
      }
    }
  }

  #[cfg(feature = "visual")]
  #[test]
  fn simbologia_decodata_apare_in_indicator_nu_e_toata_numita_cod_qr() {
    let bytes = png_of(&render_barcode(zxingcpp::BarcodeFormat::DataMatrix, "text simplu"));
    match scan_visual_codes(&bytes, &VisualLimits::default()) {
      VisualOutcome::Scanned { indicators, .. } => assert!(
        indicators.iter().any(|value| value.contains("DataMatrix")),
        "raportul spune ce simbologie a fost gasita: {:?}",
        indicators
      ),
      _ => panic!("codul DataMatrix trebuie decodat"),
    }
  }

  #[cfg(feature = "visual")]
  #[test]
  fn o_imagine_corupta_raporteaza_esec_cu_motiv_nu_un_raport_gol() {
    let mut fake_png = vec![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    fake_png.extend_from_slice(&[0u8; 32]);
    match scan_visual_codes(&fake_png, &VisualLimits::default()) {
      VisualOutcome::Failed(detail) => assert!(!detail.is_empty()),
      VisualOutcome::Scanned { codes, .. } => assert!(codes.is_empty()),
      other => panic!("asteptam esec sau scanare goala: {}", match other {
        VisualOutcome::NotImage => "NotImage",
        VisualOutcome::Unavailable(_) => "Unavailable",
        _ => "altceva",
      }),
    }
  }

  #[cfg(feature = "visual")]
  fn tiny_png() -> Vec<u8> {
    use image::{ImageFormat, RgbImage};
    let mut out = std::io::Cursor::new(Vec::new());
    RgbImage::new(8, 8).write_to(&mut out, ImageFormat::Png).expect("PNG-ul de test se scrie");
    out.into_inner()
  }

  #[cfg(feature = "visual")]
  #[test]
  fn o_imagine_peste_plafonul_de_dimensiune_este_respinsa_inainte_de_decodare() {
    let png = tiny_png();
    let limits = VisualLimits { max_dimension: 4, ..VisualLimits::default() };
    match scan_visual_codes(&png, &limits) {
      VisualOutcome::Failed(detail) => assert!(detail.contains("plafonul"), "{detail}"),
      other => panic!("o imagine peste plafon trebuie respinsa: {}", match other {
        VisualOutcome::Scanned { .. } => "a fost scanata",
        VisualOutcome::NotImage => "NotImage",
        VisualOutcome::Unavailable(_) => "Unavailable",
        VisualOutcome::Failed(_) => unreachable!(),
      }),
    }
  }

  #[cfg(feature = "visual")]
  #[test]
  fn o_imagine_valida_fara_cod_qr_este_scanata_si_nu_produce_indicatori() {
    let png = tiny_png();
    match scan_visual_codes(&png, &VisualLimits::default()) {
      VisualOutcome::Scanned { codes, indicators } => {
        assert!(codes.is_empty(), "o imagine goala nu contine coduri");
        assert!(indicators.is_empty(), "fara cod nu se inventeaza indicatori: {indicators:?}");
      }
      VisualOutcome::Failed(detail) => panic!("o imagine valida trebuie scanata: {detail}"),
      _ => panic!("asteptam o scanare"),
    }
  }
}
