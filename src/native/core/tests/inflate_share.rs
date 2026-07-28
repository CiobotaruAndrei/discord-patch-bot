use discord_patch_bot_logic::{inspect_untrusted_content, InspectionLimits};
use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use std::io::{Read, Write};
use std::time::Instant;

fn deflate(raw: &[u8]) -> Vec<u8> {
  let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
  encoder.write_all(raw).expect("compresia reuseste");
  encoder.finish().expect("fluxul se inchide")
}

fn inflate(compressed: &[u8]) -> Vec<u8> {
  let mut decoder = ZlibDecoder::new(compressed);
  let mut out = Vec::new();
  decoder.read_to_end(&mut out).expect("decompresia reuseste");
  out
}

fn payload_realist(bytes: usize) -> Vec<u8> {
  let sablon = b"<< /Type /Page /Contents 5 0 R >> BT /F1 12 Tf (oferta valabila azi) Tj ET 0 0 10 10 re f ";
  let mut out = Vec::with_capacity(bytes);
  while out.len() < bytes {
    out.extend_from_slice(sablon);
  }
  out.truncate(bytes);
  out
}

fn pdf_cu_fluxuri(fluxuri: usize, per_flux: usize) -> (Vec<u8>, Vec<Vec<u8>>) {
  let mut pdf = b"%PDF-1.4\n".to_vec();
  let mut comprimate = Vec::new();
  for index in 0..fluxuri {
    let comprimat = deflate(&payload_realist(per_flux));
    pdf.extend_from_slice(format!("{} 0 obj\n", index + 1).as_bytes());
    pdf.extend_from_slice(format!("<< /Filter /FlateDecode /Length {} >>\nstream\n", comprimat.len()).as_bytes());
    pdf.extend_from_slice(&comprimat);
    pdf.extend_from_slice(b"\nendstream\nendobj\n");
    comprimate.push(comprimat);
  }
  pdf.extend_from_slice(b"trailer\n<< /Size 1 /Root 1 0 R >>\n%%EOF\n");
  (pdf, comprimate)
}

fn percentila(mut durate: Vec<u128>, procent: usize) -> u128 {
  durate.sort_unstable();
  let index = (durate.len() * procent / 100).min(durate.len().saturating_sub(1));
  durate[index]
}

#[test]
#[ignore = "masuratoare de performanta; se ruleaza la cerere cu --ignored"]
fn cat_din_timpul_inspectiei_inseamna_inflate() {
  const RULARI: usize = 60;
  let (pdf, comprimate) = pdf_cu_fluxuri(24, 128 * 1024);
  let necomprimat: usize = comprimate.iter().map(|entry| inflate(entry).len()).sum();

  let mut total = Vec::with_capacity(RULARI);
  let mut doar_inflate = Vec::with_capacity(RULARI);

  for _ in 0..RULARI {
    let start = Instant::now();
    let raport = inspect_untrusted_content(&pdf, "oferta.pdf", "application/pdf", "document", InspectionLimits::default());
    total.push(start.elapsed().as_micros());
    assert!(!raport.reason.is_empty());

    let start = Instant::now();
    let mut octeti = 0usize;
    for comprimat in &comprimate {
      octeti += inflate(comprimat).len();
    }
    doar_inflate.push(start.elapsed().as_micros());
    assert_eq!(octeti, necomprimat);
  }

  let total_p50 = percentila(total.clone(), 50);
  let total_p95 = percentila(total.clone(), 95);
  let total_p99 = percentila(total, 99);
  let inflate_p50 = percentila(doar_inflate.clone(), 50);
  let inflate_p95 = percentila(doar_inflate.clone(), 95);
  let inflate_p99 = percentila(doar_inflate, 99);

  eprintln!("MASURATOARE fluxuri=24 necomprimat={necomprimat} octeti");
  eprintln!("MASURATOARE inspectie p50={total_p50}us p95={total_p95}us p99={total_p99}us");
  eprintln!("MASURATOARE inflate   p50={inflate_p50}us p95={inflate_p95}us p99={inflate_p99}us");
  eprintln!(
    "MASURATOARE cota inflate p50={:.1}% p95={:.1}%",
    100.0 * inflate_p50 as f64 / total_p50 as f64,
    100.0 * inflate_p95 as f64 / total_p95 as f64
  );
}
