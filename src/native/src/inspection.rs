use discord_patch_bot_logic as logic;
use napi::bindgen_prelude::{AsyncTask, Buffer, Env, Task};
use napi_derive::napi;

#[napi(object)]
pub struct InspectionInput {
  pub bytes: Buffer,
  pub filename: String,
  pub mime: String,
  pub mode: String,
  pub max_depth: u32,
  pub max_entries: u32,
  pub max_expanded_bytes: f64,
  pub max_compression_ratio: f64,
  pub timeout_ms: f64,
}

#[napi(object)]
pub struct InspectionReportJs {
  pub status: String,
  pub indicators: Vec<String>,
  pub reason: String,
  pub entries_inspected: u32,
  pub expanded_bytes: f64,
  pub elapsed_ms: f64,
  pub uninspectable_format: Option<String>,
  pub analysis_blind_spots: Vec<String>,
}

pub struct InspectContentTask {
  bytes: Vec<u8>,
  filename: String,
  mime: String,
  mode: String,
  max_depth: u32,
  max_entries: u32,
  max_expanded_bytes: u64,
  max_compression_ratio: f64,
  timeout_ms: u64,
}

impl Task for InspectContentTask {
  type Output = logic::InspectionReport;
  type JsValue = InspectionReportJs;

  fn compute(&mut self) -> napi::Result<Self::Output> {
    Ok(logic::inspect_untrusted_content(
      &self.bytes,
      &self.filename,
      &self.mime,
      &self.mode,
      logic::InspectionLimits {
        max_depth: self.max_depth,
        max_entries: self.max_entries,
        max_expanded_bytes: self.max_expanded_bytes,
        max_compression_ratio: self.max_compression_ratio,
        timeout_ms: self.timeout_ms,
      },
    ))
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
    Ok(InspectionReportJs {
      status: output.status,
      indicators: output.indicators,
      reason: output.reason,
      entries_inspected: output.entries_inspected,
      expanded_bytes: output.expanded_bytes as f64,
      elapsed_ms: output.elapsed_ms,
      uninspectable_format: output.uninspectable_format,
      analysis_blind_spots: output.analysis_blind_spots,
    })
  }
}

#[napi(ts_return_type = "Promise<InspectionReportJs>")]
pub fn inspect_untrusted_content(input: InspectionInput) -> AsyncTask<InspectContentTask> {
  let defaults = logic::InspectionLimits::default();
  AsyncTask::new(InspectContentTask {
    bytes: input.bytes.to_vec(),
    filename: input.filename,
    mime: input.mime,
    mode: input.mode,
    max_depth: if input.max_depth > 0 { input.max_depth } else { defaults.max_depth },
    max_entries: if input.max_entries > 0 { input.max_entries } else { defaults.max_entries },
    max_expanded_bytes: if input.max_expanded_bytes > 0.0 { input.max_expanded_bytes as u64 } else { defaults.max_expanded_bytes },
    max_compression_ratio: if input.max_compression_ratio > 0.0 { input.max_compression_ratio } else { defaults.max_compression_ratio },
    timeout_ms: if input.timeout_ms > 0.0 { input.timeout_ms as u64 } else { defaults.timeout_ms },
  })
}
