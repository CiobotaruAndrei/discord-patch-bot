use crate::executable_types::*;
use crate::executable_heuristics::*;

pub fn executable_analysis_available() -> bool {
  cfg!(feature = "executable")
}

#[cfg(feature = "executable")]
mod engine {
  use super::*;

  fn describe_machine(machine: u16) -> String {
    match machine {
      0x014c => "x86".to_string(),
      0x8664 => "x86-64".to_string(),
      0x01c0 | 0x01c4 => "ARM".to_string(),
      0xaa64 => "ARM64".to_string(),
      0x0200 => "IA-64".to_string(),
      other => format!("necunoscut (0x{other:04x})"),
    }
  }

  fn describe_elf_machine(machine: u16) -> String {
    match machine {
      3 => "x86".to_string(),
      62 => "x86-64".to_string(),
      40 => "ARM".to_string(),
      183 => "ARM64".to_string(),
      243 => "RISC-V".to_string(),
      other => format!("necunoscut ({other})"),
    }
  }

  fn section_slice(bytes: &[u8], offset: u64, size: u64, cap: usize) -> &[u8] {
    let start = offset as usize;
    if start >= bytes.len() {
      return &[];
    }
    let available = bytes.len() - start;
    let length = (size as usize).min(available).min(cap);
    &bytes[start..start + length]
  }

  fn note(indicators: &mut Vec<String>, value: String) {
    if !indicators.contains(&value) {
      indicators.push(value);
    }
  }

  fn classify_section(section: &ExecutableSection, indicators: &mut Vec<String>) {
    let lower = section.name.to_lowercase();
    for (needle, message) in SUSPICIOUS_SECTION_NAMES {
      if lower.starts_with(needle) {
        note(indicators, (*message).to_string());
      }
    }
    if section.entropy >= HIGH_ENTROPY && section.raw_size > 0 {
      note(indicators, format!("sectiunea {} are entropie mare ({:.2}), tipic pentru continut impachetat sau criptat", section.name, section.entropy));
    }
    if section.executable && section.writable {
      note(indicators, format!("sectiunea {} este si scriibila si executabila", section.name));
    }
    if section.raw_size == 0 && section.virtual_size > 0 {
      note(indicators, format!("sectiunea {} nu are continut pe disc dar cere memorie la incarcare", section.name));
    }
  }

  fn analyze_pe(bytes: &[u8], limits: &ExecutableLimits) -> Result<ExecutableReport, String> {
    let pe = goblin::pe::PE::parse(bytes).map_err(|error| error.to_string())?;
    let mut indicators: Vec<String> = Vec::new();
    let mut sections: Vec<ExecutableSection> = Vec::new();
    let mut highest_end = 0u64;

    for section in pe.sections.iter().take(limits.max_sections) {
      let name = section.name().unwrap_or("<nume invalid>").trim_end_matches('\0').to_string();
      let raw_size = u64::from(section.size_of_raw_data);
      let virtual_size = u64::from(section.virtual_size);
      let payload = section_slice(bytes, u64::from(section.pointer_to_raw_data), raw_size, limits.max_entropy_bytes);
      let entry = ExecutableSection {
        name,
        raw_size,
        virtual_size,
        entropy: shannon_entropy(payload),
        executable: section.characteristics & 0x2000_0000 != 0,
        writable: section.characteristics & 0x8000_0000 != 0,
      };
      highest_end = highest_end.max(u64::from(section.pointer_to_raw_data) + raw_size);
      classify_section(&entry, &mut indicators);
      sections.push(entry);
    }
    if pe.sections.len() > limits.max_sections {
      note(&mut indicators, format!("executabilul declara {} sectiuni, peste plafonul de {}", pe.sections.len(), limits.max_sections));
    }

    let mut libraries: Vec<String> = Vec::new();
    for library in pe.libraries.iter().take(limits.max_libraries) {
      let lower = library.to_lowercase();
      for (needle, message) in RISKY_IMPORT_LIBRARIES {
        if lower == *needle {
          note(&mut indicators, (*message).to_string());
        }
      }
      libraries.push((*library).to_string());
    }
    for import in &pe.imports {
      for (needle, message) in RISKY_IMPORT_SYMBOLS {
        if import.name.as_ref() == *needle {
          note(&mut indicators, (*message).to_string());
        }
      }
    }

    let signed = pe
      .header
      .optional_header
      .and_then(|header| header.data_directories.get_certificate_table().copied())
      .map(|directory| directory.size > 0)
      .unwrap_or(false);

    let overlay_bytes = (bytes.len() as u64).saturating_sub(highest_end);
    if overlay_bytes > 0 {
      note(&mut indicators, format!("{overlay_bytes} bytes dupa ultima sectiune (overlay), posibil payload atasat"));
    }
    if !signed {
      note(&mut indicators, "executabil PE fara semnatura Authenticode".to_string());
    }

    Ok(ExecutableReport {
      format: "PE".to_string(),
      architecture: describe_machine(pe.header.coff_header.machine),
      entry_point: u64::from(pe.entry),
      is_library: pe.is_lib,
      sections,
      imported_libraries: libraries,
      indicators,
      signed,
      overlay_bytes,
      truncated: false,
    })
  }

  fn analyze_elf(bytes: &[u8], limits: &ExecutableLimits) -> Result<ExecutableReport, String> {
    let elf = goblin::elf::Elf::parse(bytes).map_err(|error| error.to_string())?;
    let mut indicators: Vec<String> = Vec::new();
    let mut sections: Vec<ExecutableSection> = Vec::new();

    for header in elf.section_headers.iter().take(limits.max_sections) {
      let name = elf.shdr_strtab.get_at(header.sh_name).unwrap_or("<nume invalid>").to_string();
      let payload = section_slice(bytes, header.sh_offset, header.sh_size, limits.max_entropy_bytes);
      let entry = ExecutableSection {
        name,
        raw_size: header.sh_size,
        virtual_size: header.sh_size,
        entropy: shannon_entropy(payload),
        executable: header.sh_flags & 0x4 != 0,
        writable: header.sh_flags & 0x1 != 0,
      };
      classify_section(&entry, &mut indicators);
      sections.push(entry);
    }

    let libraries: Vec<String> = elf.libraries.iter().take(limits.max_libraries).map(|entry| (*entry).to_string()).collect();
    if elf.is_lib {
      note(&mut indicators, "obiect ELF partajat (biblioteca), nu executabil de sine statator".to_string());
    }

    Ok(ExecutableReport {
      format: "ELF".to_string(),
      architecture: describe_elf_machine(elf.header.e_machine),
      entry_point: elf.entry,
      is_library: elf.is_lib,
      sections,
      imported_libraries: libraries,
      indicators,
      signed: false,
      overlay_bytes: 0,
      truncated: false,
    })
  }

  fn analyze_mach(bytes: &[u8], limits: &ExecutableLimits) -> Result<ExecutableReport, String> {
    let mach = goblin::mach::Mach::parse(bytes).map_err(|error| error.to_string())?;
    let binary = match mach {
      goblin::mach::Mach::Binary(binary) => binary,
      goblin::mach::Mach::Fat(fat) => match fat.get(0).map_err(|error| error.to_string())? {
        goblin::mach::SingleArch::MachO(binary) => binary,
        goblin::mach::SingleArch::Archive(_) => {
          return Err("containerul Mach-O grupeaza o arhiva, nu un executabil".to_string());
        }
      },
    };
    let mut indicators: Vec<String> = Vec::new();
    let mut sections: Vec<ExecutableSection> = Vec::new();
    for segment in binary.segments.iter().take(limits.max_sections) {
      let name = segment.name().unwrap_or("<nume invalid>").to_string();
      let payload = section_slice(bytes, segment.fileoff, segment.filesize, limits.max_entropy_bytes);
      let entry = ExecutableSection {
        name,
        raw_size: segment.filesize,
        virtual_size: segment.vmsize,
        entropy: shannon_entropy(payload),
        executable: segment.initprot & 0x4 != 0,
        writable: segment.initprot & 0x2 != 0,
      };
      classify_section(&entry, &mut indicators);
      sections.push(entry);
    }
    let libraries: Vec<String> = binary.libs.iter().take(limits.max_libraries).map(|entry| (*entry).to_string()).collect();

    Ok(ExecutableReport {
      format: "Mach-O".to_string(),
      architecture: format!("{:?}", binary.header.cputype),
      entry_point: binary.entry,
      is_library: false,
      sections,
      imported_libraries: libraries,
      indicators,
      signed: false,
      overlay_bytes: 0,
      truncated: false,
    })
  }

  pub fn analyze(bytes: &[u8], limits: &ExecutableLimits) -> ExecutableOutcome {
    if !looks_like_executable(bytes) {
      return ExecutableOutcome::NotExecutable;
    }
    let result = if is_pe(bytes) {
      analyze_pe(bytes, limits)
    } else if is_elf(bytes) {
      analyze_elf(bytes, limits)
    } else {
      analyze_mach(bytes, limits)
    };
    match result {
      Ok(report) => ExecutableOutcome::Analyzed(report),
      Err(detail) => ExecutableOutcome::Failed(detail),
    }
  }

  fn region(bytes: &[u8], architecture: String, offset: u64, size: u64, address: u64) -> Option<CodeRegion> {
    let start = offset as usize;
    if start >= bytes.len() || size == 0 {
      return None;
    }
    let length = (size as usize).min(bytes.len() - start);
    (length > 0).then_some(CodeRegion { architecture, offset: start, size: length, address })
  }

  pub fn locate(bytes: &[u8], limits: &ExecutableLimits) -> Option<CodeRegion> {
    if is_pe(bytes) {
      let pe = goblin::pe::PE::parse(bytes).ok()?;
      let architecture = describe_machine(pe.header.coff_header.machine);
      let section = pe
        .sections
        .iter()
        .take(limits.max_sections)
        .filter(|section| section.characteristics & 0x2000_0000 != 0)
        .max_by_key(|section| section.size_of_raw_data)?;
      region(
        bytes,
        architecture,
        u64::from(section.pointer_to_raw_data),
        u64::from(section.size_of_raw_data),
        pe.image_base + u64::from(section.virtual_address),
      )
    } else if is_elf(bytes) {
      let elf = goblin::elf::Elf::parse(bytes).ok()?;
      let architecture = describe_elf_machine(elf.header.e_machine);
      let header = elf
        .section_headers
        .iter()
        .take(limits.max_sections)
        .filter(|header| header.sh_flags & 0x4 != 0 && header.sh_type != 8)
        .max_by_key(|header| header.sh_size)?;
      region(bytes, architecture, header.sh_offset, header.sh_size, header.sh_addr)
    } else {
      None
    }
  }
}

#[cfg(not(feature = "executable"))]
mod engine {
  use super::*;

  pub fn analyze(bytes: &[u8], _limits: &ExecutableLimits) -> ExecutableOutcome {
    if !looks_like_executable(bytes) {
      return ExecutableOutcome::NotExecutable;
    }
    ExecutableOutcome::Unavailable(
      "analiza executabilelor nu este compilata in acest build (feature `executable` dezactivat)".to_string(),
    )
  }

  pub fn locate(_bytes: &[u8], _limits: &ExecutableLimits) -> Option<CodeRegion> {
    None
  }
}

pub fn analyze_executable(bytes: &[u8], limits: &ExecutableLimits) -> ExecutableOutcome {
  engine::analyze(bytes, limits)
}

pub fn locate_code_region(bytes: &[u8], limits: &ExecutableLimits) -> Option<CodeRegion> {
  if !looks_like_executable(bytes) {
    return None;
  }
  engine::locate(bytes, limits)
}

#[cfg(test)]
pub(crate) mod tests {
  use super::*;

  #[test]
  fn entropia_distinge_continutul_repetitiv_de_cel_aleator() {
    assert_eq!(shannon_entropy(&[]), 0.0);
    assert_eq!(shannon_entropy(&[0x41; 4096]), 0.0);
    let varied: Vec<u8> = (0..=255u8).cycle().take(4096).collect();
    assert!(shannon_entropy(&varied) > 7.9, "un flux uniform pe toate valorile are entropie aproape maxima");
    let text = b"acesta este un text normal, cu litere si spatii, repetat de mai multe ori. ".repeat(50);
    let entropy = shannon_entropy(&text);
    assert!(entropy > 3.0 && entropy < 5.5, "textul obisnuit sta intre extreme (a dat {entropy})");
  }

  #[test]
  fn detectia_de_format_nu_confunda_continutul_obisnuit_cu_un_executabil() {
    assert!(looks_like_executable(&[0x4d, 0x5a, 0x90, 0x00]));
    assert!(looks_like_executable(&[0x7f, b'E', b'L', b'F', 2]));
    assert!(!looks_like_executable(b"%PDF-1.7"));
    assert!(!looks_like_executable(b"PK\x03\x04"));
    assert!(!looks_like_executable(b""));
  }

  #[test]
  fn un_continut_care_nu_e_executabil_nu_e_tratat_ca_esec_de_analiza() {
    let outcome = analyze_executable(b"%PDF-1.7 document", &ExecutableLimits::default());
    assert!(matches!(outcome, ExecutableOutcome::NotExecutable));
  }

  #[test]
  fn un_executabil_trunchiat_raporteaza_esec_cu_motiv_nu_un_raport_inventat() {
    let outcome = analyze_executable(&[0x4d, 0x5a, 0x90, 0x00, 0x03], &ExecutableLimits::default());
    match outcome {
      ExecutableOutcome::Failed(detail) => assert!(!detail.is_empty(), "esecul poarta motivul parserului"),
      ExecutableOutcome::Unavailable(_) => {}
      other => panic!("asteptam esec, am primit {}", match other {
        ExecutableOutcome::Analyzed(report) => format!("raport {}", report.format),
        ExecutableOutcome::NotExecutable => "NotExecutable".to_string(),
        _ => "altceva".to_string(),
      }),
    }
  }

  #[test]
  fn disponibilitatea_este_raportata_dupa_feature_nu_presupusa() {
    assert_eq!(executable_analysis_available(), cfg!(feature = "executable"));
  }

  #[cfg(feature = "executable")]
  pub(crate) fn minimal_pe(section_name: &str, section_payload: &[u8], characteristics: u32) -> Vec<u8> {
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

  #[cfg(feature = "executable")]
  #[test]
  fn un_pe_real_cu_sectiune_de_packer_si_entropie_mare_produce_indicatori() {
    let payload: Vec<u8> = (0..=255u8).cycle().take(8192).collect();
    let pe = minimal_pe("UPX0", &payload, 0xE000_0020);
    match analyze_executable(&pe, &ExecutableLimits::default()) {
      ExecutableOutcome::Analyzed(report) => {
        assert_eq!(report.format, "PE");
        assert_eq!(report.architecture, "x86-64");
        assert_eq!(report.sections.len(), 1);
        assert!(report.indicators.iter().any(|entry| entry.contains("packer UPX")), "numele sectiunii e recunoscut: {:?}", report.indicators);
        assert!(report.indicators.iter().any(|entry| entry.contains("entropie mare")), "entropia payload-ului e masurata: {:?}", report.indicators);
        assert!(report.indicators.iter().any(|entry| entry.contains("scriibila si executabila")));
        assert!(report.indicators.iter().any(|entry| entry.contains("fara semnatura Authenticode")));
        assert!(!report.signed);
      }
      ExecutableOutcome::Failed(detail) => panic!("PE-ul de test trebuie parsat: {detail}"),
      _ => panic!("asteptam un raport"),
    }
  }

  #[cfg(feature = "executable")]
  #[test]
  fn un_pe_obisnuit_nu_produce_indicatorii_de_packer() {
    let payload = b"acesta este cod obisnuit, cu structura repetitiva si entropie mica".repeat(64);
    let pe = minimal_pe(".text", &payload, 0x6000_0020);
    match analyze_executable(&pe, &ExecutableLimits::default()) {
      ExecutableOutcome::Analyzed(report) => {
        assert!(!report.indicators.iter().any(|entry| entry.contains("packer")), "un .text normal nu e packer: {:?}", report.indicators);
        assert!(!report.indicators.iter().any(|entry| entry.contains("entropie mare")));
        assert!(!report.indicators.iter().any(|entry| entry.contains("scriibila si executabila")));
      }
      ExecutableOutcome::Failed(detail) => panic!("PE-ul de test trebuie parsat: {detail}"),
      _ => panic!("asteptam un raport"),
    }
  }

  #[cfg(feature = "executable")]
  #[test]
  fn octetii_de_dupa_ultima_sectiune_sunt_raportati_ca_overlay() {
    let payload = vec![0x41u8; 512];
    let mut pe = minimal_pe(".text", &payload, 0x6000_0020);
    pe.extend_from_slice(&vec![0x42u8; 4096]);
    match analyze_executable(&pe, &ExecutableLimits::default()) {
      ExecutableOutcome::Analyzed(report) => {
        assert_eq!(report.overlay_bytes, 4096);
        assert!(report.indicators.iter().any(|entry| entry.contains("overlay")));
      }
      ExecutableOutcome::Failed(detail) => panic!("PE-ul de test trebuie parsat: {detail}"),
      _ => panic!("asteptam un raport"),
    }
  }
}
