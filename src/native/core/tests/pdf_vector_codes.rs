#![cfg(feature = "visual")]

use discord_patch_bot_logic::{
  inspect_untrusted_content, rasterize_filled_rectangles, InspectionLimits, VectorRasterLimits
};
use flate2::write::ZlibEncoder;
use flate2::Compression;
use std::io::Write;

const QR_PAYLOAD: &str = "https://exemplu.test/qr-vectorial";

fn qr_modules() -> (u32, Vec<bool>) {
  let barcode = zxingcpp::create(zxingcpp::BarcodeFormat::QRCode)
    .from_str(QR_PAYLOAD)
    .expect("codul QR se genereaza");
  let bitmap = barcode.to_image_with(&zxingcpp::write().scale(1)).expect("bitmap-ul se produce");
  let side = bitmap.width() as u32;
  let modules = bitmap.data().iter().map(|sample| *sample < 128).collect();
  (side, modules)
}

fn content_stream_din_module(side: u32, modules: &[bool]) -> String {
  let mut operators = String::from("0 g\n");
  for row in 0..side {
    for column in 0..side {
      if !modules[(row * side + column) as usize] {
        continue;
      }
      let x = column;
      let y = side - 1 - row;
      operators.push_str(&format!("{x} {y} 1 1 re\n"));
    }
  }
  operators.push_str("f\n");
  operators
}

fn deflate(raw: &[u8]) -> Vec<u8> {
  let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
  encoder.write_all(raw).expect("compresia reuseste");
  encoder.finish().expect("fluxul se inchide")
}

fn pdf_cu_flux_de_continut(side: u32, stream: &[u8]) -> Vec<u8> {
  let mut objects: Vec<Vec<u8>> = Vec::new();
  objects.push(b"<< /Type /Catalog /Pages 2 0 R >>".to_vec());
  objects.push(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_vec());
  objects.push(
    format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {side} {side}] /Contents 4 0 R >>").into_bytes()
  );
  let mut content = format!("<< /Filter /FlateDecode /Length {} >>\nstream\n", stream.len()).into_bytes();
  content.extend_from_slice(stream);
  content.extend_from_slice(b"\nendstream");
  objects.push(content);

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
    format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n", objects.len() + 1).as_bytes()
  );
  pdf
}

#[test]
fn un_qr_desenat_vectorial_in_pagina_pdf_e_citit_fara_pdfium() {
  let (side, modules) = qr_modules();
  let stream = content_stream_din_module(side, &modules);
  let pdf = pdf_cu_flux_de_continut(side, &deflate(stream.as_bytes()));

  let report = inspect_untrusted_content(&pdf, "oferta.pdf", "application/pdf", "document", InspectionLimits::default());
  assert!(
    report.indicators.iter().any(|entry| entry.contains("desenat vectorial in pagina PDF")),
    "un cod desenat ca dreptunghiuri umplute e rasterizat si citit, fara randare completa de pagina: {:?}",
    report.indicators
  );
  assert!(
    report.indicators.iter().any(|entry| entry.contains("cod QR")),
    "codul trece prin aceleasi verificari ca orice imagine: {:?}",
    report.indicators
  );
}

#[test]
fn un_flux_de_continut_obisnuit_nu_produce_rasterizare() {
  let text = b"BT /F1 12 Tf 72 720 Td (buna ziua) Tj ET";
  assert!(
    rasterize_filled_rectangles(text, &VectorRasterLimits::default()).is_none(),
    "fara dreptunghiuri nu se rasterizeaza nimic"
  );

  let cateva = b"0 g 0 0 5 5 re 10 10 5 5 re f";
  assert!(
    rasterize_filled_rectangles(cateva, &VectorRasterLimits::default()).is_none(),
    "sub pragul de dreptunghiuri nu merita rasterizat"
  );
}

#[test]
fn rasterizarea_respecta_plafonul_de_pixeli() {
  let mut urias = String::from("0 g\n");
  for index in 0..40 {
    urias.push_str(&format!("{index} 0 1 1 re\n"));
  }
  urias.push_str("f\n");
  let limits = VectorRasterLimits { max_rectangles: 40_000, max_pixels: 16, target_edge: 900 };
  assert!(
    rasterize_filled_rectangles(urias.as_bytes(), &limits).is_none(),
    "peste plafonul de pixeli nu se aloca nimic"
  );
}
