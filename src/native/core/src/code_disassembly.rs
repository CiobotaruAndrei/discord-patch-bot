pub struct DisassemblyLimits {
  pub max_instructions: usize,
  pub max_code_bytes: usize,
  pub max_indicators: usize,
}

impl Default for DisassemblyLimits {
  fn default() -> Self {
    Self { max_instructions: 4096, max_code_bytes: 256 * 1024, max_indicators: 12 }
  }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DecodedInstruction {
  pub address: u64,
  pub next_address: u64,
  pub mnemonic: String,
  pub operands: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct DisassemblyReport {
  pub instructions_read: usize,
  pub truncated: bool,
  pub indicators: Vec<String>,
}

#[derive(Debug)]
pub enum DisassemblyOutcome {
  Unavailable(String),
  UnsupportedArchitecture(String),
  Failed(String),
  Analyzed(DisassemblyReport),
}

pub fn disassembly_available() -> bool {
  cfg!(feature = "disassembly")
}

fn destination(operands: &str) -> &str {
  match operands.find(',') {
    Some(index) => operands[..index].trim(),
    None => operands.trim(),
  }
}

fn source(operands: &str) -> Option<&str> {
  operands.rfind(',').map(|index| operands[index + 1..].trim())
}

fn parse_immediate(text: &str) -> Option<u64> {
  let trimmed = text.trim();
  let digits = trimmed.strip_prefix("0x")?;
  if digits.is_empty() || digits.len() > 16 {
    return None;
  }
  u64::from_str_radix(digits, 16).ok()
}

fn is_bare_register(text: &str) -> bool {
  let trimmed = text.trim();
  if trimmed.len() < 2 || trimmed.len() > 5 {
    return false;
  }
  if !trimmed.starts_with(|c: char| c.is_ascii_lowercase()) {
    return false;
  }
  trimmed.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

fn writes_to_memory(operands: &str) -> bool {
  destination(operands).contains('[')
}

const PEB_SELECTORS: [&str; 2] = ["fs:[0x30]", "gs:[0x60]"];

fn peb_access_indicator(instructions: &[DecodedInstruction]) -> Option<String> {
  let found = instructions
    .iter()
    .any(|insn| PEB_SELECTORS.iter().any(|selector| insn.operands.contains(selector)));
  found.then(|| "citire directa a PEB, tiparul prin care codul isi gaseste functiile fara tabel de import".to_string())
}

fn direct_syscall_indicator(instructions: &[DecodedInstruction]) -> Option<String> {
  let found = instructions.iter().any(|insn| {
    matches!(insn.mnemonic.as_str(), "syscall" | "sysenter")
      || (insn.mnemonic == "int" && parse_immediate(&insn.operands) == Some(0x2e))
  });
  found.then(|| "apel de sistem direct, ocoleste bibliotecile pe care le urmareste analiza".to_string())
}

const GET_PC_WINDOW: usize = 3;

fn position_independent_indicator(instructions: &[DecodedInstruction]) -> Option<String> {
  for (index, insn) in instructions.iter().enumerate() {
    if insn.mnemonic != "call" {
      continue;
    }
    if parse_immediate(&insn.operands) != Some(insn.next_address) {
      continue;
    }
    let window_end = instructions.len().min(index + 1 + GET_PC_WINDOW);
    if instructions[index + 1..window_end].iter().any(|next| next.mnemonic == "pop") {
      return Some("secventa call/pop de aflare a propriei adrese, tipar de cod independent de pozitie".to_string());
    }
  }
  None
}

const INDIRECT_DISPATCH_THRESHOLD: usize = 8;

fn indirect_dispatch_indicator(instructions: &[DecodedInstruction]) -> Option<String> {
  let count = instructions
    .iter()
    .filter(|insn| matches!(insn.mnemonic.as_str(), "call" | "jmp") && is_bare_register(&insn.operands))
    .count();
  (count >= INDIRECT_DISPATCH_THRESHOLD)
    .then(|| format!("control indirect prin registru in {count} locuri, tinta apelurilor se afla abia la rulare"))
}

const DECODING_MNEMONICS: [&str; 7] = ["xor", "rol", "ror", "sub", "add", "not", "neg"];
const DECODING_LOOP_WINDOW: usize = 24;

fn is_branch(mnemonic: &str) -> bool {
  mnemonic == "jmp" || mnemonic == "loop" || (mnemonic.starts_with('j') && mnemonic.len() <= 4)
}

fn decoding_loop_indicator(instructions: &[DecodedInstruction]) -> Option<String> {
  for (index, insn) in instructions.iter().enumerate() {
    if !DECODING_MNEMONICS.contains(&insn.mnemonic.as_str()) || !writes_to_memory(&insn.operands) {
      continue;
    }
    let window_end = instructions.len().min(index + 1 + DECODING_LOOP_WINDOW);
    let closes_loop = instructions[index + 1..window_end].iter().any(|next| {
      is_branch(&next.mnemonic)
        && parse_immediate(&next.operands).is_some_and(|target| target <= insn.address)
    });
    if closes_loop {
      return Some("bucla care rescrie memorie, tiparul unui stub care isi despacheteaza singur codul".to_string());
    }
  }
  None
}

const STACK_STRING_THRESHOLD: usize = 6;

fn printable_immediate(value: u64, text: &str) -> bool {
  let digits = text.trim().trim_start_matches("0x").len();
  if digits < 4 {
    return false;
  }
  let width = digits.div_ceil(2);
  (0..width).all(|index| {
    let byte = ((value >> (index * 8)) & 0xff) as u8;
    byte.is_ascii_graphic() || byte == b' '
  })
}

fn stack_string_indicator(instructions: &[DecodedInstruction]) -> Option<String> {
  let count = instructions
    .iter()
    .filter(|insn| {
      if insn.mnemonic != "mov" || !writes_to_memory(&insn.operands) {
        return false;
      }
      source(&insn.operands)
        .and_then(|text| parse_immediate(text).map(|value| printable_immediate(value, text)))
        .unwrap_or(false)
    })
    .count();
  (count >= STACK_STRING_THRESHOLD)
    .then(|| format!("{count} siruri construite direct pe stiva, text ascuns fata de o cautare simpla"))
}

pub fn code_indicators(instructions: &[DecodedInstruction], limits: &DisassemblyLimits) -> Vec<String> {
  let detectors = [
    peb_access_indicator,
    direct_syscall_indicator,
    position_independent_indicator,
    indirect_dispatch_indicator,
    decoding_loop_indicator,
    stack_string_indicator,
  ];
  let mut indicators: Vec<String> = Vec::new();
  for detector in detectors {
    if indicators.len() >= limits.max_indicators {
      break;
    }
    if let Some(indicator) = detector(instructions) {
      indicators.push(indicator);
    }
  }
  indicators
}

#[cfg(feature = "disassembly")]
mod engine {
  use super::{DecodedInstruction, DisassemblyLimits};
  use capstone::arch::BuildsCapstone;
  use capstone::{Capstone, Endian};

  fn builder(architecture: &str) -> Option<Result<Capstone, capstone::Error>> {
    use capstone::arch::arm::ArchMode as ArmMode;
    use capstone::arch::arm64::ArchMode as Arm64Mode;
    use capstone::arch::x86::ArchMode as X86Mode;
    use capstone::arch::BuildsCapstoneEndian;

    match architecture {
      "x86" => Some(Capstone::new().x86().mode(X86Mode::Mode32).build()),
      "x86-64" => Some(Capstone::new().x86().mode(X86Mode::Mode64).build()),
      "ARM" => Some(Capstone::new().arm().mode(ArmMode::Arm).build()),
      "ARM64" => Some(Capstone::new().arm64().mode(Arm64Mode::Arm).endian(Endian::Little).build()),
      _ => None,
    }
  }

  pub fn decode(
    code: &[u8],
    architecture: &str,
    address: u64,
    limits: &DisassemblyLimits,
  ) -> Result<Option<(Vec<DecodedInstruction>, bool)>, String> {
    let Some(built) = builder(architecture) else { return Ok(None) };
    let engine = built.map_err(|error| error.to_string())?;
    let window = &code[..code.len().min(limits.max_code_bytes)];
    let instructions = engine
      .disasm_count(window, address, limits.max_instructions)
      .map_err(|error| error.to_string())?;

    let decoded: Vec<DecodedInstruction> = instructions
      .iter()
      .map(|insn| DecodedInstruction {
        address: insn.address(),
        next_address: insn.address() + insn.len() as u64,
        mnemonic: insn.mnemonic().unwrap_or_default().to_ascii_lowercase(),
        operands: insn.op_str().unwrap_or_default().to_ascii_lowercase(),
      })
      .collect();

    let truncated = decoded.len() >= limits.max_instructions || window.len() < code.len();
    Ok(Some((decoded, truncated)))
  }
}

#[cfg(feature = "disassembly")]
pub fn disassemble_code(
  code: &[u8],
  architecture: &str,
  address: u64,
  limits: &DisassemblyLimits,
) -> DisassemblyOutcome {
  if code.is_empty() {
    return DisassemblyOutcome::Failed("sectiune de cod goala".to_string());
  }
  match engine::decode(code, architecture, address, limits) {
    Err(error) => DisassemblyOutcome::Failed(error),
    Ok(None) => DisassemblyOutcome::UnsupportedArchitecture(architecture.to_string()),
    Ok(Some((instructions, truncated))) => DisassemblyOutcome::Analyzed(DisassemblyReport {
      instructions_read: instructions.len(),
      truncated,
      indicators: code_indicators(&instructions, limits),
    }),
  }
}

#[cfg(not(feature = "disassembly"))]
pub fn disassemble_code(
  _code: &[u8],
  _architecture: &str,
  _address: u64,
  _limits: &DisassemblyLimits,
) -> DisassemblyOutcome {
  DisassemblyOutcome::Unavailable("dezasamblarea nu este compilata in aceasta build".to_string())
}
