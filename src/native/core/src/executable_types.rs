pub struct ExecutableSection {
  pub name: String,
  pub raw_size: u64,
  pub virtual_size: u64,
  pub entropy: f64,
  pub executable: bool,
  pub writable: bool,
}

pub struct ExecutableReport {
  pub format: String,
  pub architecture: String,
  pub entry_point: u64,
  pub is_library: bool,
  pub sections: Vec<ExecutableSection>,
  pub imported_libraries: Vec<String>,
  pub indicators: Vec<String>,
  pub signed: bool,
  pub overlay_bytes: u64,
  pub truncated: bool,
}

pub enum ExecutableOutcome {
  Unavailable(String),
  NotExecutable,
  Failed(String),
  Analyzed(ExecutableReport),
}

pub struct ExecutableLimits {
  pub max_sections: usize,
  pub max_libraries: usize,
  pub max_entropy_bytes: usize,
}

pub struct CodeRegion {
  pub architecture: String,
  pub offset: usize,
  pub size: usize,
  pub address: u64,
}

impl Default for ExecutableLimits {
  fn default() -> Self {
    Self { max_sections: 64, max_libraries: 64, max_entropy_bytes: 1024 * 1024 }
  }
}
