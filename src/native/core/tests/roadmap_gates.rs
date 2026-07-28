use discord_patch_bot_logic::{inspect_untrusted_content, looks_like_image, InspectionLimits};

#[cfg(feature = "visual")]
use flate2::write::ZlibEncoder;
#[cfg(feature = "visual")]
use flate2::Compression;
#[cfg(feature = "visual")]
use std::io::Write;

const QR_PAYLOAD: &str = "https://exemplu.test/plata-urgenta";

#[cfg(feature = "visual")]
fn qr_grayscale() -> (u32, u32, Vec<u8>) {
  let barcode = zxingcpp::create(zxingcpp::BarcodeFormat::QRCode)
    .from_str(QR_PAYLOAD)
    .expect("codul QR se genereaza");
  let bitmap = barcode
    .to_image_with(&zxingcpp::write().scale(4))
    .expect("bitmap-ul se produce");
  (bitmap.width() as u32, bitmap.height() as u32, bitmap.data().to_vec())
}

#[cfg(feature = "visual")]
fn deflate(raw: &[u8]) -> Vec<u8> {
  let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
  encoder.write_all(raw).expect("compresia reuseste");
  encoder.finish().expect("fluxul se inchide")
}

#[cfg(feature = "visual")]
fn pdf_with_embedded_image(width: u32, height: u32, gray: &[u8]) -> Vec<u8> {
  let stream = deflate(gray);
  let content = format!("q {width} 0 0 {height} 0 0 cm /Im0 Do Q");
  let mut objects: Vec<Vec<u8>> = Vec::new();
  objects.push(b"<< /Type /Catalog /Pages 2 0 R >>".to_vec());
  objects.push(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_vec());
  objects.push(
    format!(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] \
       /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>"
    )
    .into_bytes()
  );
  let mut image_object = format!(
    "<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace /DeviceGray \
     /BitsPerComponent 8 /Filter /FlateDecode /Length {} >>\nstream\n",
    stream.len()
  )
  .into_bytes();
  image_object.extend_from_slice(&stream);
  image_object.extend_from_slice(b"\nendstream");
  objects.push(image_object);
  objects.push(
    format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()).into_bytes()
  );

  let mut pdf = b"%PDF-1.4\n".to_vec();
  let mut offsets: Vec<usize> = Vec::new();
  for (index, body) in objects.iter().enumerate() {
    offsets.push(pdf.len());
    pdf.extend_from_slice(format!("{} 0 obj\n", index + 1).as_bytes());
    pdf.extend_from_slice(body);
    pdf.extend_from_slice(b"\nendobj\n");
  }
  let xref_at = pdf.len();
  pdf.extend_from_slice(format!("xref\n0 {}\n", objects.len() + 1).as_bytes());
  pdf.extend_from_slice(b"0000000000 65535 f \n");
  for offset in &offsets {
    pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
  }
  pdf.extend_from_slice(
    format!(
      "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n",
      objects.len() + 1
    )
    .as_bytes()
  );
  pdf
}

fn indicators_for(bytes: &[u8], filename: &str, mime: &str, mode: &str) -> Vec<String> {
  inspect_untrusted_content(bytes, filename, mime, mode, InspectionLimits::default()).indicators
}

#[cfg(feature = "visual")]
#[test]
fn un_qr_incorporat_ca_imagine_in_pdf_e_citit_fara_pdfium() {
  let (width, height, gray) = qr_grayscale();
  let pdf = pdf_with_embedded_image(width, height, &gray);
  assert!(pdf.starts_with(b"%PDF-"), "mostra e un PDF");

  let standalone = {
    let mut png = Vec::new();
    image::DynamicImage::ImageLuma8(
      image::GrayImage::from_raw(width, height, gray.clone()).expect("dimensiunile corespund")
    )
    .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
    .expect("PNG-ul se scrie");
    indicators_for(&png, "cod.png", "image/png", "content")
  };
  assert!(
    standalone.iter().any(|entry| entry.contains("cod QR")),
    "acelasi cod, livrat ca PNG de sine statator, este citit: {standalone:?}"
  );

  let embedded = indicators_for(&pdf, "factura.pdf", "application/pdf", "document");
  assert!(
    embedded.iter().any(|entry| entry.contains("cod QR")),
    "masuratoare pentru gate-ul PDFium: daca acest cod ajunge sa fie citit din PDF, golul s-a inchis \
     si roadmap-ul trebuie actualizat, nu testul sters. Indicatori: {embedded:?}"
  );
}

#[test]
fn gate_libheif_heic_si_avif_nu_ajung_niciodata_la_scanarea_vizuala() {
  let mut heic = vec![0u8; 12];
  heic[3] = 24;
  heic[4..8].copy_from_slice(b"ftyp");
  heic[8..12].copy_from_slice(b"heic");
  let mut avif = heic.clone();
  avif[8..12].copy_from_slice(b"avif");

  assert!(!looks_like_image(&heic), "masuratoare pentru gate-ul libheif: HEIC nu e recunoscut ca imagine");
  assert!(!looks_like_image(&avif), "masuratoare pentru gate-ul libheif: AVIF nu e recunoscut ca imagine");

  for (bytes, name, mime) in [(&heic, "poza.heic", "image/heic"), (&avif, "poza.avif", "image/avif")] {
    let indicators = indicators_for(bytes, name, mime, "content");
    assert!(
      !indicators.iter().any(|entry| entry.contains("cod")),
      "{name} nu produce niciun semnal vizual azi: {indicators:?}"
    );
  }
}

#[cfg(feature = "visual")]
fn png_of_qr() -> Vec<u8> {
  let (width, height, gray) = qr_grayscale();
  let mut png = Vec::new();
  image::DynamicImage::ImageLuma8(
    image::GrayImage::from_raw(width, height, gray).expect("dimensiunile corespund")
  )
  .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
  .expect("PNG-ul se scrie");
  png
}

#[cfg(feature = "visual")]
fn stored_zip(name: &str, payload: &[u8]) -> Vec<u8> {
  let mut crc = flate2::Crc::new();
  crc.update(payload);
  let checksum = crc.sum().to_le_bytes();
  let size = (payload.len() as u32).to_le_bytes();
  let name_len = (name.len() as u16).to_le_bytes();
  let mut local = Vec::new();
  local.extend_from_slice(b"PK");
  local.extend_from_slice(&[20, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  local.extend_from_slice(&checksum);
  local.extend_from_slice(&size);
  local.extend_from_slice(&size);
  local.extend_from_slice(&name_len);
  local.extend_from_slice(&[0, 0]);
  local.extend_from_slice(name.as_bytes());
  local.extend_from_slice(payload);

  let mut central = Vec::new();
  central.extend_from_slice(b"PK");
  central.extend_from_slice(&[20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  central.extend_from_slice(&checksum);
  central.extend_from_slice(&size);
  central.extend_from_slice(&size);
  central.extend_from_slice(&name_len);
  central.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  central.extend_from_slice(name.as_bytes());

  let mut zip = local.clone();
  let central_at = (zip.len() as u32).to_le_bytes();
  let central_len = (central.len() as u32).to_le_bytes();
  zip.extend_from_slice(&central);
  zip.extend_from_slice(b"PK");
  zip.extend_from_slice(&[0, 0, 0, 0, 1, 0, 1, 0]);
  zip.extend_from_slice(&central_len);
  zip.extend_from_slice(&central_at);
  zip.extend_from_slice(&[0, 0]);
  zip
}

#[cfg(feature = "visual")]
#[test]
fn un_png_cu_qr_dintr_o_arhiva_e_citit_ca_si_cand_ar_fi_trimis_direct() {
  let png = png_of_qr();
  let zip = stored_zip("cod.png", &png);
  let indicators = indicators_for(&zip, "arhiva.zip", "application/zip", "content");
  assert!(
    indicators.iter().any(|entry| entry.contains("cod QR")),
    "un PNG cu cod QR dintr-o arhiva trebuie citit la fel ca acelasi PNG trimis direct;      nu e nevoie de nicio librarie noua pentru asta: {indicators:?}"
  );
}
