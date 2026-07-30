use crate::executable_types::*;

pub(crate) const PACKED_ENTROPY_THRESHOLD: f64 = 7.2;

pub(crate) const MEANINGFUL_CODE_BYTES: u64 = 4096;

pub fn analysis_blind_spots(report: &ExecutableReport) -> Vec<String> {
  let mut spots: Vec<String> = Vec::new();
  let code_bytes: u64 = report
    .sections
    .iter()
    .filter(|section| section.executable)
    .map(|section| section.raw_size)
    .sum();
  if code_bytes >= MEANINGFUL_CODE_BYTES && report.imported_libraries.is_empty() {
    spots.push("cod fara importuri rezolvabile".to_string());
  }
  let packer_cunoscut = report
    .indicators
    .iter()
    .any(|indicator| indicator.contains("packer") || indicator.contains("impachetat cu"));
  let entropie_de_impachetare = report
    .sections
    .iter()
    .any(|section| section.executable && section.entropy >= PACKED_ENTROPY_THRESHOLD);
  if entropie_de_impachetare && !packer_cunoscut {
    spots.push("cod cu entropie de impachetare fara packer cunoscut".to_string());
  }
  if report.indicators.is_empty() && code_bytes >= MEANINGFUL_CODE_BYTES {
    spots.push("executabil fara niciun indicator structural".to_string());
  }
  spots
}

pub fn shannon_entropy(bytes: &[u8]) -> f64 {
  if bytes.is_empty() {
    return 0.0;
  }
  let mut counts = [0u64; 256];
  for byte in bytes {
    counts[*byte as usize] += 1;
  }
  let total = bytes.len() as f64;
  let mut entropy = 0.0;
  for count in counts {
    if count == 0 {
      continue;
    }
    let probability = count as f64 / total;
    entropy -= probability * probability.log2();
  }
  entropy
}

pub(crate) const HIGH_ENTROPY: f64 = 7.2;

pub(crate) const SUSPICIOUS_SECTION_NAMES: &[(&str, &str)] = &[
  ("upx0", "sectiune de packer UPX"),
  ("upx1", "sectiune de packer UPX"),
  (".aspack", "sectiune de packer ASPack"),
  (".themida", "sectiune de protector Themida"),
  (".vmp0", "sectiune de protector VMProtect"),
  (".vmp1", "sectiune de protector VMProtect"),
  (".petite", "sectiune de packer Petite"),
  (".mpress1", "sectiune de packer MPRESS"),
];

pub(crate) const RISKY_IMPORT_LIBRARIES: &[(&str, &str)] = &[
  ("ws2_32.dll", "importa API de retea (winsock)"),
  ("wininet.dll", "importa API de descarcare HTTP"),
  ("winhttp.dll", "importa API de descarcare HTTP"),
  ("urlmon.dll", "importa API de descarcare de fisiere"),
  ("advapi32.dll", "importa API de registru sau servicii"),
  ("crypt32.dll", "importa API de criptografie"),
  ("psapi.dll", "importa API de enumerare a proceselor"),
  ("dbghelp.dll", "importa API de depanare"),
];

pub(crate) const RISKY_IMPORT_SYMBOLS: &[(&str, &str)] = &[
  ("VirtualAllocEx", "alocare de memorie in alt proces (injectie)"),
  ("WriteProcessMemory", "scriere in memoria altui proces (injectie)"),
  ("CreateRemoteThread", "pornire de fir de executie in alt proces (injectie)"),
  ("NtUnmapViewOfSection", "inlocuire de imagine de proces (process hollowing)"),
  ("SetWindowsHookEx", "instalare de hook global"),
  ("IsDebuggerPresent", "verificare anti-depanare"),
  ("CheckRemoteDebuggerPresent", "verificare anti-depanare"),
  ("ShellExecuteA", "lansare de proces extern"),
  ("ShellExecuteW", "lansare de proces extern"),
  ("WinExec", "lansare de proces extern"),
  ("URLDownloadToFileA", "descarcare de fisier din internet"),
  ("URLDownloadToFileW", "descarcare de fisier din internet"),
];

pub(crate) fn is_pe(bytes: &[u8]) -> bool {
  bytes.len() >= 2 && bytes[0] == 0x4d && bytes[1] == 0x5a
}

pub(crate) fn is_elf(bytes: &[u8]) -> bool {
  bytes.len() >= 4 && bytes[0] == 0x7f && &bytes[1..4] == b"ELF"
}

pub(crate) fn is_mach_o(bytes: &[u8]) -> bool {
  if bytes.len() < 4 {
    return false;
  }
  let magic = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
  matches!(magic, 0xfeed_face | 0xfeed_facf | 0xcefa_edfe | 0xcffa_edfe | 0xbebafeca | 0xcafebabe)
}

pub fn looks_like_executable(bytes: &[u8]) -> bool {
  is_pe(bytes) || is_elf(bytes) || is_mach_o(bytes)
}
