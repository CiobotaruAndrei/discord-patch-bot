use discord_patch_bot_logic::{inspect_untrusted_content, InspectionLimits};

fn encint(mut value: u64) -> Vec<u8> {
  if value == 0 {
    return vec![0];
  }
  let mut parts: Vec<u8> = Vec::new();
  while value > 0 {
    parts.push((value % 128) as u8);
    value /= 128;
  }
  parts.reverse();
  let last = parts.len() - 1;
  for (index, part) in parts.iter_mut().enumerate() {
    if index != last {
      *part |= 0x80;
    }
  }
  parts
}

fn chm(nume: &[&str]) -> Vec<u8> {
  let mut out = b"ITSF".to_vec();
  out.extend_from_slice(&[0u8; 60]);
  out.extend_from_slice(b"PMGL");
  out.extend_from_slice(&[0u8; 16]);
  for entry in nume {
    out.extend_from_slice(&encint(entry.len() as u64));
    out.extend_from_slice(entry.as_bytes());
    out.extend_from_slice(&encint(1));
    out.extend_from_slice(&encint(0));
    out.extend_from_slice(&encint(128));
  }
  out
}

#[test]
fn un_chm_isi_arata_continutul_desi_ramane_neconfirmat() {
  let raport = inspect_untrusted_content(
    &chm(&["/index.htm", "/script/incarcator.js"]),
    "ajutor.chm",
    "application/vnd.ms-htmlhelp",
    "content",
    InspectionLimits::default()
  );
  assert_eq!(raport.status, "uncertain", "fara decompresie verdictul ramane neconfirmat");
  assert!(
    raport.indicators.iter().any(|entry| entry.contains("intrari listate din structura")),
    "structura CHM se poate citi fara libmspack, chiar daca continutul comprimat nu: {:?}",
    raport.indicators
  );
}

#[test]
fn un_chm_gol_nu_inventeaza_indicatori() {
  let raport = inspect_untrusted_content(&chm(&[]), "gol.chm", "application/vnd.ms-htmlhelp", "content", InspectionLimits::default());
  assert!(
    !raport.indicators.iter().any(|entry| entry.contains("intrari listate")),
    "fara intrari nu se raporteaza nimic: {:?}",
    raport.indicators
  );
}

#[cfg(feature = "visual")]
#[test]
fn o_imagine_fara_cod_alimenteaza_gate_ul_de_ocr() {
  let mut mare = image::GrayImage::new(400, 400);
  let mut stare = 0x243f_6a88u32;
  for pixel in mare.pixels_mut() {
    stare = stare.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
    *pixel = image::Luma([(stare >> 24) as u8]);
  }
  let mut png = Vec::new();
  image::DynamicImage::ImageLuma8(mare)
    .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
    .expect("PNG-ul se scrie");

  let raport = inspect_untrusted_content(&png, "captura.png", "image/png", "content", InspectionLimits::default());
  assert_eq!(raport.status, "inspected");
  assert!(
    raport.analysis_blind_spots.iter().any(|spot| spot.contains("text posibil necitit")),
    "o imagine scanata fara cod e exact populatia pe care ar tinti-o OCR: {:?}",
    raport.analysis_blind_spots
  );
}

#[cfg(feature = "visual")]
#[test]
fn o_imagine_minuscula_nu_umple_metricile() {
  let mica = image::GrayImage::from_pixel(4, 4, image::Luma([255u8]));
  let mut png = Vec::new();
  image::DynamicImage::ImageLuma8(mica)
    .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
    .expect("PNG-ul se scrie");

  let raport = inspect_untrusted_content(&png, "icon.png", "image/png", "content", InspectionLimits::default());
  assert!(
    raport.analysis_blind_spots.is_empty(),
    "o pictograma nu poate purta text de phishing: {:?}",
    raport.analysis_blind_spots
  );
}
