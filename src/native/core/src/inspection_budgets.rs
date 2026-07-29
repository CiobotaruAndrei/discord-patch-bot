use std::time::Instant;

pub const CFB_MAX_FAT_SECTORS: usize = 512;
pub const CFB_MAX_DIR_ENTRIES: usize = 4096;
pub const PDF_MAX_STREAMS: usize = 64;
pub const PDF_MAX_RECONSTRUCTED_PIXELS: u64 = 4_000_000;
pub const IMAGE_TEXT_BLIND_SPOT_BYTES: usize = 16 * 1024;
pub const TEXT_LINK_SCAN_BYTES: usize = 256 * 1024;
pub const ISO_BMFF_PREVIEW_SCAN_BYTES: usize = 512 * 1024;
pub const PDF_DANGEROUS_NAMES: &[&str] = &["JavaScript", "JS", "OpenAction", "AA", "Launch", "EmbeddedFile", "RichMedia", "GoToR"];
pub const CFB_END_OF_CHAIN: u32 = 0xffff_fffe;
pub const CFB_FREE_SECT: u32 = 0xffff_ffff;
pub const PDF_DICT_LOOKBEHIND: usize = 4096;

pub struct InspectionLimits {
  pub max_depth: u32,
  pub max_entries: u32,
  pub max_expanded_bytes: u64,
  pub max_compression_ratio: f64,
  pub timeout_ms: u64,
}

impl Default for InspectionLimits {
  fn default() -> Self {
    Self {
      max_depth: 3,
      max_entries: 64,
      max_expanded_bytes: 8 * 1024 * 1024,
      max_compression_ratio: 100.0,
      timeout_ms: 100,
    }
  }
}

pub(crate) struct Budget {
  pub(crate) entries: u32,
  pub(crate) expanded_bytes: u64,
  pub(crate) started: Instant,
  pub(crate) limits: InspectionLimits,
}

pub(crate) fn enforce_budget(budget: &mut Budget, compressed_bytes: u64, expanded_bytes: u64) -> Option<String> {
  budget.entries += 1;
  budget.expanded_bytes += expanded_bytes;
  if budget.entries > budget.limits.max_entries {
    return Some(format!("arhiva depaseste limita de {} intrari", budget.limits.max_entries));
  }
  if budget.expanded_bytes > budget.limits.max_expanded_bytes {
    return Some(format!("arhiva depaseste limita de {} bytes decomprimati", budget.limits.max_expanded_bytes));
  }
  if compressed_bytes > 0 && (expanded_bytes as f64 / compressed_bytes as f64) > budget.limits.max_compression_ratio {
    return Some(format!("arhiva depaseste raportul maxim de compresie {}:1", budget.limits.max_compression_ratio as u64));
  }
  if budget.started.elapsed().as_millis() as u64 > budget.limits.timeout_ms {
    return Some(format!("inspectia arhivei a depasit {} ms", budget.limits.timeout_ms));
  }
  None
}
