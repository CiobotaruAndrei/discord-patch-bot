use discord_patch_bot_logic::{
  analyze_executable, inspect_untrusted_content, scan_visual_codes, ExecutableLimits, ExecutableOutcome,
  InspectionLimits, VisualLimits, VisualOutcome,
};
use flate2::write::{DeflateEncoder, GzEncoder};
use flate2::Compression;
use sha2::{Digest, Sha256};
use std::io::Write;

enum Expectation {
  Content {
    filename: &'static str,
    mime: &'static str,
    mode: &'static str,
    status: &'static str,
    reason: Option<&'static str>,
    indicators: &'static [&'static str],
    forbidden: &'static [&'static str],
  },
  Executable {
    format: &'static str,
    indicators: &'static [&'static str],
    forbidden: &'static [&'static str],
  },
  Visual {
    payload: Option<&'static str>,
    looks_like_url: bool,
    indicators: &'static [&'static str],
  },
}

struct Sample {
  name: &'static str,
  category: &'static str,
  benign: bool,
  digest: &'static str,
  bytes: Vec<u8>,
  expectation: Expectation,
}

fn deflate_raw(data: &[u8]) -> Vec<u8> {
  let mut encoder = DeflateEncoder::new(Vec::new(), Compression::new(6));
  encoder.write_all(data).expect("deflate scrie in memorie");
  encoder.finish().expect("deflate se finalizeaza")
}

fn gzip(data: &[u8]) -> Vec<u8> {
  let mut encoder = GzEncoder::new(Vec::new(), Compression::new(6));
  encoder.write_all(data).expect("gzip scrie in memorie");
  encoder.finish().expect("gzip se finalizeaza")
}

struct ZipEntry {
  name: &'static str,
  data: Vec<u8>,
  deflate: bool,
  encrypted: bool,
}

fn stored(name: &'static str, data: &[u8]) -> ZipEntry {
  ZipEntry { name, data: data.to_vec(), deflate: false, encrypted: false }
}

fn deflated(name: &'static str, data: Vec<u8>) -> ZipEntry {
  ZipEntry { name, data, deflate: true, encrypted: false }
}

fn zip_archive(entries: Vec<ZipEntry>) -> Vec<u8> {
  let mut out = Vec::new();
  for item in entries {
    let payload = if item.deflate { deflate_raw(&item.data) } else { item.data.clone() };
    out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
    out.extend_from_slice(&20u16.to_le_bytes());
    out.extend_from_slice(&(if item.encrypted { 1u16 } else { 0u16 }).to_le_bytes());
    out.extend_from_slice(&(if item.deflate { 8u16 } else { 0u16 }).to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(&(item.data.len() as u32).to_le_bytes());
    out.extend_from_slice(&(item.name.len() as u16).to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(item.name.as_bytes());
    out.extend_from_slice(&payload);
  }
  out
}

fn tar_archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
  let mut out = Vec::new();
  for (name, data) in entries {
    let mut header = vec![0u8; 512];
    header[..name.len()].copy_from_slice(name.as_bytes());
    let size = format!("{:011o}\0", data.len());
    header[124..124 + size.len()].copy_from_slice(size.as_bytes());
    header[257..263].copy_from_slice(b"ustar\0");
    out.extend_from_slice(&header);
    let padded = data.len().div_ceil(512) * 512;
    out.extend_from_slice(data);
    out.extend(std::iter::repeat_n(0u8, padded - data.len()));
  }
  out.extend(std::iter::repeat_n(0u8, 1024));
  out
}

fn windows_binary(filler: u8, length: usize) -> Vec<u8> {
  let mut out = vec![0x4d, 0x5a, 0x90, 0x00];
  out.extend(std::iter::repeat_n(filler, length));
  out
}

fn pdf_document(body: &str) -> Vec<u8> {
  let mut out = String::from("%PDF-1.7\n");
  out.push_str("1 0 obj\n<< /Type /Catalog /Pages 2 0 R ");
  out.push_str(body);
  out.push_str(" >>\nendobj\n");
  out.push_str("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  out.push_str("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n");
  out.push_str("trailer\n<< /Root 1 0 R /Size 4 >>\n%%EOF\n");
  out.into_bytes()
}

fn portable_executable(section_name: &str, section_payload: &[u8], characteristics: u32) -> Vec<u8> {
  let mut out = vec![0u8; 0x80];
  out[0] = 0x4d;
  out[1] = 0x5a;
  out[0x3c..0x40].copy_from_slice(&0x80u32.to_le_bytes());

  out.extend_from_slice(&[0x50, 0x45, 0x00, 0x00]);
  out.extend_from_slice(&0x8664u16.to_le_bytes());
  out.extend_from_slice(&1u16.to_le_bytes());
  out.extend_from_slice(&0u32.to_le_bytes());
  out.extend_from_slice(&0u32.to_le_bytes());
  out.extend_from_slice(&0u32.to_le_bytes());
  out.extend_from_slice(&240u16.to_le_bytes());
  out.extend_from_slice(&0x0002u16.to_le_bytes());

  let optional_start = out.len();
  out.extend_from_slice(&0x20bu16.to_le_bytes());
  out.extend_from_slice(&[14, 0]);
  out.extend_from_slice(&0x1000u32.to_le_bytes());
  out.extend_from_slice(&0u32.to_le_bytes());
  out.extend_from_slice(&0u32.to_le_bytes());
  out.extend_from_slice(&0x1000u32.to_le_bytes());
  out.extend_from_slice(&0x1000u32.to_le_bytes());
  out.extend_from_slice(&0x0000_0001_4000_0000u64.to_le_bytes());
  out.extend_from_slice(&0x1000u32.to_le_bytes());
  out.extend_from_slice(&0x200u32.to_le_bytes());
  out.extend_from_slice(&[6, 0, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0]);
  out.extend_from_slice(&0u32.to_le_bytes());
  out.extend_from_slice(&0x4000u32.to_le_bytes());
  out.extend_from_slice(&0x400u32.to_le_bytes());
  out.extend_from_slice(&0u32.to_le_bytes());
  out.extend_from_slice(&3u16.to_le_bytes());
  out.extend_from_slice(&0u16.to_le_bytes());
  for value in [0x100000u64, 0x1000u64, 0x100000u64, 0x1000u64] {
    out.extend_from_slice(&value.to_le_bytes());
  }
  out.extend_from_slice(&0u32.to_le_bytes());
  out.extend_from_slice(&16u32.to_le_bytes());
  for _ in 0..16 {
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
  }
  let optional_size = out.len() - optional_start;
  let size_field = optional_start - 4;
  out[size_field..size_field + 2].copy_from_slice(&(optional_size as u16).to_le_bytes());

  let raw_offset = 0x400u32;
  let mut name = [0u8; 8];
  let bytes = section_name.as_bytes();
  name[..bytes.len().min(8)].copy_from_slice(&bytes[..bytes.len().min(8)]);
  out.extend_from_slice(&name);
  out.extend_from_slice(&(section_payload.len() as u32).to_le_bytes());
  out.extend_from_slice(&0x1000u32.to_le_bytes());
  out.extend_from_slice(&(section_payload.len() as u32).to_le_bytes());
  out.extend_from_slice(&raw_offset.to_le_bytes());
  out.extend_from_slice(&0u32.to_le_bytes());
  out.extend_from_slice(&0u32.to_le_bytes());
  out.extend_from_slice(&0u16.to_le_bytes());
  out.extend_from_slice(&0u16.to_le_bytes());
  out.extend_from_slice(&characteristics.to_le_bytes());

  out.resize(raw_offset as usize, 0);
  out.extend_from_slice(section_payload);
  out
}

fn pseudo_random_payload(seed: u64, length: usize) -> Vec<u8> {
  let mut state = seed;
  (0..length)
    .map(|_| {
      state ^= state << 13;
      state ^= state >> 7;
      state ^= state << 17;
      (state >> 24) as u8
    })
    .collect()
}

#[cfg(feature = "visual")]
fn qr_png(payload: &str) -> Vec<u8> {
  let code = qrcode::QrCode::new(payload.as_bytes()).expect("payload-ul incape intr-un cod QR");
  let modules = code.width();
  let colors = code.to_colors();
  let scale = 8usize;
  let quiet = 4usize;
  let side = (modules + quiet * 2) * scale;
  let mut buffer = vec![255u8; side * side];
  for row in 0..modules {
    for column in 0..modules {
      if colors[row * modules + column] != qrcode::Color::Dark {
        continue;
      }
      for offset_y in 0..scale {
        for offset_x in 0..scale {
          let y = (row + quiet) * scale + offset_y;
          let x = (column + quiet) * scale + offset_x;
          buffer[y * side + x] = 0;
        }
      }
    }
  }
  encode_gray_png(side as u32, side as u32, buffer)
}

#[cfg(feature = "visual")]
fn blank_png(side: u32) -> Vec<u8> {
  encode_gray_png(side, side, vec![255u8; (side * side) as usize])
}

#[cfg(feature = "visual")]
fn encode_gray_png(width: u32, height: u32, pixels: Vec<u8>) -> Vec<u8> {
  let image = image::GrayImage::from_raw(width, height, pixels).expect("dimensiunile corespund octetilor");
  let mut out = std::io::Cursor::new(Vec::new());
  image::DynamicImage::ImageLuma8(image)
    .write_to(&mut out, image::ImageFormat::Png)
    .expect("PNG-ul se codifica in memorie");
  out.into_inner()
}

fn hex_digest(bytes: &[u8]) -> String {
  let mut hasher = Sha256::new();
  hasher.update(bytes);
  hasher
    .finalize()
    .iter()
    .map(|byte| format!("{:02x}", byte))
    .collect()
}

fn corpus() -> Vec<Sample> {
  let mut samples = vec![
    Sample {
      name: "arhiva-zip-benigna",
      category: "arhiva",
      benign: true,
      digest: "2848dc7f83ecb9d76b68e339937b414e28052c9a3f6e39d12cae3715593197c6",
      bytes: zip_archive(vec![stored("citeste-ma.txt", b"note de lansare"), stored("schimbari.txt", b"lista de schimbari")]),
      expectation: Expectation::Content {
        filename: "pachet.zip",
        mime: "application/zip",
        mode: "archive",
        status: "inspected",
        reason: None,
        indicators: &[],
        forbidden: &["executabil PE intern", "fisier executabil sau script intern"],
      },
    },
    Sample {
      name: "arhiva-zip-cu-executabil",
      category: "arhiva",
      benign: false,
      digest: "649b658906fc333a9d7c7cc784b07205992ba6378c471734656c9a7d7d14858b",
      bytes: zip_archive(vec![deflated("setup/installer.exe", windows_binary(0x41, 512))]),
      expectation: Expectation::Content {
        filename: "setup.zip",
        mime: "application/zip",
        mode: "archive",
        status: "inspected",
        reason: None,
        indicators: &["fisier executabil sau script intern", "executabil PE intern"],
        forbidden: &[],
      },
    },
    Sample {
      name: "arhiva-zip-imbricata-cu-executabil",
      category: "arhiva",
      benign: false,
      digest: "f5634337366c804944477bedc47bc69b50271f275579e59140654c92e3ce931a",
      bytes: zip_archive(vec![stored(
        "bundle/inner.zip",
        &zip_archive(vec![deflated("payload/tool.exe", windows_binary(0x41, 256))]),
      )]),
      expectation: Expectation::Content {
        filename: "bundle.zip",
        mime: "application/zip",
        mode: "archive",
        status: "inspected",
        reason: None,
        indicators: &["executabil PE intern"],
        forbidden: &[],
      },
    },
    Sample {
      name: "arhiva-zip-criptata",
      category: "arhiva",
      benign: false,
      digest: "d1756607423b47599e367135135a02eb5d9d4bfd3e655fd3846415c8508b64c0",
      bytes: zip_archive(vec![ZipEntry { name: "secret.bin", data: vec![7u8; 64], deflate: false, encrypted: true }]),
      expectation: Expectation::Content {
        filename: "secret.zip",
        mime: "application/zip",
        mode: "archive",
        status: "uncertain",
        reason: Some("arhiva criptata ZIP"),
        indicators: &[],
        forbidden: &[],
      },
    },
    Sample {
      name: "arhiva-zip-bomba-de-compresie",
      category: "arhiva",
      benign: false,
      digest: "5b60a0fa1ffed520736f10f29d2cb23129e533d78ac9717fc14794a605d4fa4e",
      bytes: zip_archive(vec![deflated("bomb.bin", vec![0u8; 4096 * 400])]),
      expectation: Expectation::Content {
        filename: "bomb.zip",
        mime: "application/zip",
        mode: "archive",
        status: "uncertain",
        reason: Some("arhiva depaseste raportul maxim de compresie 100:1"),
        indicators: &[],
        forbidden: &[],
      },
    },
    Sample {
      name: "arhiva-tar-office-cu-macro",
      category: "arhiva",
      benign: false,
      digest: "2c3f64b5441b2840abb938ab6f152ba6cfbd170140f589a7e838e93024ac7add",
      bytes: tar_archive(&[
        ("word/vbaProject.bin", b"Attribute VB_Name"),
        (
          "word/_rels/document.xml.rels",
          b"<Relationships><Relationship TargetMode=\"External\" Target=\"http://exemplu.test/x\"/></Relationships>",
        ),
      ]),
      expectation: Expectation::Content {
        filename: "office.tar",
        mime: "application/x-tar",
        mode: "archive",
        status: "inspected",
        reason: None,
        indicators: &["macro sau script Office intern", "referinta externa in document Office"],
        forbidden: &[],
      },
    },
    Sample {
      name: "arhiva-gzip-peste-tar-cu-macro",
      category: "arhiva",
      benign: false,
      digest: "6ea690e07248de01a48888a948d92ebfe07841cc4c652affebda092e332a86eb",
      bytes: gzip(&tar_archive(&[("word/vbaProject.bin", b"Attribute VB_Name")])),
      expectation: Expectation::Content {
        filename: "office.tgz",
        mime: "application/gzip",
        mode: "archive",
        status: "inspected",
        reason: None,
        indicators: &["macro sau script Office intern"],
        forbidden: &[],
      },
    },
    Sample {
      name: "pdf-benign",
      category: "pdf",
      benign: true,
      digest: "87ebcb2c200af0a6233ef8be30dbbaacaae3424c5e16a33acbfac463de2aeea2",
      bytes: pdf_document("/Lang (ro-RO)"),
      expectation: Expectation::Content {
        filename: "manual.pdf",
        mime: "application/pdf",
        mode: "document",
        status: "inspected",
        reason: None,
        indicators: &[],
        forbidden: &["indicator de script/actiune automata in document"],
      },
    },
    Sample {
      name: "pdf-cu-openaction-javascript",
      category: "pdf",
      benign: false,
      digest: "3fd7c93176c0345b2bd2bf662b0fd94fff9a6f9ce34f3269d5051d0aeca23102",
      bytes: pdf_document("/OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >>"),
      expectation: Expectation::Content {
        filename: "factura.pdf",
        mime: "application/pdf",
        mode: "document",
        status: "inspected",
        reason: None,
        indicators: &["indicator de script/actiune automata in document"],
        forbidden: &[],
      },
    },
    Sample {
      name: "pdf-cu-nume-de-actiune-ofuscat",
      category: "pdf",
      benign: false,
      digest: "fd51404d796562391baf4ab9533f119ff56348e719d00e9a510d279d0b2d8a1b",
      bytes: pdf_document("/Open#41ction << /S /J#61vaScript >>"),
      expectation: Expectation::Content {
        filename: "chitanta.pdf",
        mime: "application/pdf",
        mode: "document",
        status: "inspected",
        reason: None,
        indicators: &["indicator de script/actiune automata in document"],
        forbidden: &[],
      },
    },
    Sample {
      name: "pdf-cu-launch",
      category: "pdf",
      benign: false,
      digest: "59869ac4f5fe437b3b9aa8fb1eef255ef92ae6ebb7d00cd698e73b45fa1dfdc9",
      bytes: pdf_document("/OpenAction << /S /Launch /F (cmd.exe) >>"),
      expectation: Expectation::Content {
        filename: "raport.pdf",
        mime: "application/pdf",
        mode: "document",
        status: "inspected",
        reason: None,
        indicators: &["indicator de script/actiune automata in document"],
        forbidden: &[],
      },
    },
    Sample {
      name: "pdf-cu-fisier-incorporat",
      category: "pdf",
      benign: false,
      digest: "33e9495e1b3a1e49f608c16abb264197e6503d29a06bf64d1b4c5b7c1f424fc5",
      bytes: pdf_document("/Names << /EmbeddedFiles 4 0 R >>"),
      expectation: Expectation::Content {
        filename: "arhiva.pdf",
        mime: "application/pdf",
        mode: "document",
        status: "inspected",
        reason: None,
        indicators: &["indicator de lansare de proces sau continut incorporat"],
        forbidden: &[],
      },
    },
  ];

  #[cfg(feature = "executable")]
  samples.extend([
    Sample {
      name: "executabil-pe-impachetat-upx",
      category: "executabil",
      benign: false,
      digest: "3fb0327b876ea60c649899d16f95922ff2829750f39ba1c2714511c89e510208",
      bytes: portable_executable("UPX0", &pseudo_random_payload(0x51f3_2b7c_9a04_6de1, 8192), 0xE000_0020),
      expectation: Expectation::Executable {
        format: "PE",
        indicators: &["packer UPX"],
        forbidden: &[],
      },
    },
    Sample {
      name: "executabil-pe-obisnuit",
      category: "executabil",
      benign: true,
      digest: "5907945b140ca4c11e3b3b9e764e802cf951733ac5dd9e99bd578fa1c40172c6",
      bytes: portable_executable(".text", &vec![0x90u8; 4096], 0x6000_0020),
      expectation: Expectation::Executable {
        format: "PE",
        indicators: &[],
        forbidden: &["packer"],
      },
    },
  ]);

  #[cfg(feature = "visual")]
  samples.extend([
    Sample {
      name: "qr-cu-link",
      category: "qr",
      benign: false,
      digest: "7829bf01695ebd388129b30a46bc2b78843f11432816f83a951fa50d5ecdcef6",
      bytes: qr_png("https://exemplu.test/pachet"),
      expectation: Expectation::Visual {
        payload: Some("https://exemplu.test/pachet"),
        looks_like_url: true,
        indicators: &["cod QR care contine un link"],
      },
    },
    Sample {
      name: "qr-cu-text-simplu",
      category: "qr",
      benign: false,
      digest: "b927e00ef7354949328454e8bb046df0828835f333073b78bc2c81cd2273e594",
      bytes: qr_png("actualizare 1.2.3"),
      expectation: Expectation::Visual {
        payload: Some("actualizare 1.2.3"),
        looks_like_url: false,
        indicators: &["cod QR in imagine"],
      },
    },
    Sample {
      name: "imagine-fara-qr",
      category: "qr",
      benign: true,
      digest: "f4895cbcb329473b12fbe369d9ea83e4831f86676c09462128b05de32720f88f",
      bytes: blank_png(128),
      expectation: Expectation::Visual { payload: None, looks_like_url: false, indicators: &[] },
    },
  ]);

  samples
}

fn required_categories() -> Vec<&'static str> {
  let mut categories = vec!["arhiva", "pdf"];
  if cfg!(feature = "executable") {
    categories.push("executabil");
  }
  if cfg!(feature = "visual") {
    categories.push("qr");
  }
  categories
}

#[test]
fn octetii_fiecarui_esantion_raman_neschimbati_fata_de_amprenta_fixata() {
  let mut drifted: Vec<String> = Vec::new();
  for sample in corpus() {
    let actual = hex_digest(&sample.bytes);
    if actual != sample.digest {
      drifted.push(format!("{} => {} ({} octeti)", sample.name, actual, sample.bytes.len()));
    }
  }
  assert!(
    drifted.is_empty(),
    "corpusul s-a schimbat; daca schimbarea e intentionata, actualizeaza amprentele:\n{}",
    drifted.join("\n")
  );
}

#[test]
fn numele_esantioanelor_sunt_unice() {
  let mut names: Vec<&str> = corpus().iter().map(|sample| sample.name).collect();
  let total = names.len();
  names.sort_unstable();
  names.dedup();
  assert_eq!(names.len(), total, "un nume duplicat ascunde un esantion in raportul de esec");
}

#[test]
fn fiecare_categorie_ceruta_are_si_un_esantion_ostil_si_unul_benign() {
  let samples = corpus();
  for category in required_categories() {
    let in_category: Vec<&Sample> = samples.iter().filter(|sample| sample.category == category).collect();
    assert!(!in_category.is_empty(), "categoria {} nu are niciun esantion", category);
    assert!(
      in_category.iter().any(|sample| !sample.benign),
      "categoria {} nu are esantion ostil: corpusul nu ar prinde o regresie de detectie",
      category
    );
    assert!(
      in_category.iter().any(|sample| sample.benign),
      "categoria {} nu are esantion benign: corpusul nu ar prinde o regresie de fals-pozitiv",
      category
    );
  }
}

#[test]
fn fiecare_esantion_produce_exact_verdictul_fixat() {
  for sample in corpus() {
    match sample.expectation {
      Expectation::Content { filename, mime, mode, status, reason, indicators, forbidden } => {
        let report = inspect_untrusted_content(&sample.bytes, filename, mime, mode, InspectionLimits::default());
        assert_eq!(report.status, status, "{}: verdict schimbat (motiv: {})", sample.name, report.reason);
        if let Some(expected) = reason {
          assert_eq!(report.reason, expected, "{}: motivul raportat s-a schimbat", sample.name);
        }
        for needle in indicators {
          assert!(
            report.indicators.iter().any(|value| value.contains(needle)),
            "{}: indicatorul \"{}\" a disparut; indicatori actuali: {:?}",
            sample.name,
            needle,
            report.indicators
          );
        }
        for needle in forbidden {
          assert!(
            !report.indicators.iter().any(|value| value.contains(needle)),
            "{}: fals pozitiv, indicatorul \"{}\" nu are ce cauta aici: {:?}",
            sample.name,
            needle,
            report.indicators
          );
        }
      }
      Expectation::Executable { format, indicators, forbidden } => {
        match analyze_executable(&sample.bytes, &ExecutableLimits::default()) {
          ExecutableOutcome::Analyzed(report) => {
            assert_eq!(report.format, format, "{}: formatul recunoscut s-a schimbat", sample.name);
            for needle in indicators {
              assert!(
                report.indicators.iter().any(|value| value.contains(needle)),
                "{}: indicatorul \"{}\" a disparut: {:?}",
                sample.name,
                needle,
                report.indicators
              );
            }
            for needle in forbidden {
              assert!(
                !report.indicators.iter().any(|value| value.contains(needle)),
                "{}: fals pozitiv pe \"{}\": {:?}",
                sample.name,
                needle,
                report.indicators
              );
            }
          }
          ExecutableOutcome::Unavailable(detail) => {
            panic!("{}: esantioanele de executabil exista doar cu feature-ul activ ({})", sample.name, detail);
          }
          ExecutableOutcome::NotExecutable => panic!("{}: esantionul trebuie recunoscut ca executabil", sample.name),
          ExecutableOutcome::Failed(detail) => panic!("{}: analiza a esuat ({})", sample.name, detail),
        }
      }
      Expectation::Visual { payload, looks_like_url, indicators } => {
        match scan_visual_codes(&sample.bytes, &VisualLimits::default()) {
          VisualOutcome::Scanned { codes, indicators: found } => match payload {
            Some(expected) => {
              let decoded = codes.first().unwrap_or_else(|| panic!("{}: niciun cod QR decodat", sample.name));
              assert_eq!(decoded.payload, expected, "{}: payload-ul decodat s-a schimbat", sample.name);
              assert_eq!(decoded.looks_like_url, looks_like_url, "{}: clasificarea de link s-a schimbat", sample.name);
              for needle in indicators {
                assert!(
                  found.iter().any(|value| value.contains(needle)),
                  "{}: indicatorul \"{}\" a disparut: {:?}",
                  sample.name,
                  needle,
                  found
                );
              }
            }
            None => {
              assert!(codes.is_empty(), "{}: o imagine fara cod QR nu are ce decoda: {:?}", sample.name, codes.len());
              assert!(found.is_empty(), "{}: o imagine fara cod QR nu produce indicatori: {:?}", sample.name, found);
            }
          },
          VisualOutcome::Unavailable(detail) => {
            panic!("{}: esantioanele de QR exista doar cu feature-ul activ ({})", sample.name, detail);
          }
          VisualOutcome::NotImage => panic!("{}: esantionul trebuie recunoscut ca imagine", sample.name),
          VisualOutcome::Failed(detail) => panic!("{}: scanarea a esuat ({})", sample.name, detail),
        }
      }
    }
  }
}

#[test]
fn fiecare_esantion_inghetat_exista_in_indexul_etichetat() {
  for sample in corpus() {
    let gasit = discord_patch_bot_logic::lookup_by_digest(sample.digest)
      .unwrap_or_else(|| panic!("esantionul {} nu apare in indexul etichetat", sample.name));
    assert_eq!(gasit.id, sample.name, "identitatea difera pentru {}", sample.name);
    assert_eq!(gasit.category, sample.category, "categoria difera pentru {}", sample.name);
    assert_eq!(gasit.hostile, !sample.benign, "eticheta ostil/benign difera pentru {}", sample.name);
  }
}

#[test]
fn amprentele_fuzzy_din_index_sunt_recalculabile_din_mostrele_inghetate() {
  use discord_patch_bot_logic::{fuzzy_digest, lookup_by_digest, FuzzyMatchLimits};

  let limits = FuzzyMatchLimits::default();
  let mut verificate = 0;
  for sample in corpus() {
    let intrare = lookup_by_digest(sample.digest)
      .unwrap_or_else(|| panic!("mostra {} lipseste din indexul etichetat", sample.name));
    let calculata = fuzzy_digest(&sample.bytes, &limits).unwrap_or_default();
    assert_eq!(
      calculata, intrare.fuzzy,
      "amprenta fuzzy a mostrei {} nu mai corespunde continutului ei; un index care se desparte de mostre        raporteaza asemanari cu ceva ce nu mai exista",
      sample.name
    );
    verificate += 1;
  }
  assert!(verificate >= 17, "s-au verificat doar {verificate} mostre");
}

#[test]
fn o_mostra_ostila_cu_prefix_adaugat_e_tot_recunoscuta() {
  use discord_patch_bot_logic::{digest_of, lookup_by_digest, similar_sample_indicators};

  let originala = corpus()
    .into_iter()
    .find(|sample| sample.name == "arhiva-tar-office-cu-macro")
    .expect("mostra ostila exista in corpus");

  let mut variata = vec![0x5au8; 64];
  variata.extend_from_slice(&originala.bytes);

  assert!(
    lookup_by_digest(&digest_of(&variata)).is_none(),
    "exact asta e golul pe care il inchide potrivirea aproximativa: 64 de octeti pusi in fata schimba      complet amprenta exacta, iar cautarea dupa SHA-256 nu mai gaseste nimic"
  );

  let indicatori = similar_sample_indicators(&variata);
  assert!(
    indicatori.iter().any(|indicator| indicator.contains("arhiva-tar-office-cu-macro")),
    "adaugarea de continut inaintea celui real e o evaziune banala; masurat, distanta ramane 45: {indicatori:?}"
  );
  assert!(
    indicatori.iter().any(|indicator| indicator.contains("ostila")),
    "eticheta mostrei trebuie sa ajunga in raport, nu doar numele ei: {indicatori:?}"
  );
}

#[test]
fn o_schimbare_de_un_octet_e_raportata_ca_foarte_apropiata_nu_doar_inrudita() {
  use discord_patch_bot_logic::similar_sample_indicators;

  let originala = corpus()
    .into_iter()
    .find(|sample| sample.name == "arhiva-tar-office-cu-macro")
    .expect("mostra ostila exista in corpus");

  let mut variata = originala.bytes.clone();
  variata[100] ^= 0xff;

  let indicatori = similar_sample_indicators(&variata);
  assert!(
    indicatori.iter().any(|indicator| indicator.contains("foarte apropiat")),
    "un singur octet schimbat da distanta 4; raportul trebuie sa distinga asta de o simpla inrudire: {indicatori:?}"
  );
}

#[test]
fn un_continut_rescris_masiv_nu_mai_e_raportat_ca_ruda() {
  use discord_patch_bot_logic::similar_sample_indicators;

  let originala = corpus()
    .into_iter()
    .find(|sample| sample.name == "arhiva-tar-office-cu-macro")
    .expect("mostra ostila exista in corpus");

  let mut variata = originala.bytes.clone();
  let pas = (variata.len() / 64).max(1);
  for index in (0..variata.len()).step_by(pas) {
    variata[index] = variata[index].wrapping_add(1);
  }

  assert!(
    similar_sample_indicators(&variata).is_empty(),
    "masurat, distanta e 160; un prag care ar accepta si asta ar lega orice fisier de orice mostra"
  );
}

#[test]
fn un_continut_fara_legatura_cu_corpusul_nu_produce_asemanari_inventate() {
  use discord_patch_bot_logic::similar_sample_indicators;

  let text = "Salut, asta e un mesaj obisnuit despre actualizari de jocuri. ".repeat(40);
  assert!(
    similar_sample_indicators(text.as_bytes()).is_empty(),
    "un prag prea larg ar transforma orice fisier intr-o ruda a corpusului"
  );
}



