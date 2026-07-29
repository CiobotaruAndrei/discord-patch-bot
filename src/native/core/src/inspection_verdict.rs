
pub struct InspectionReport {
  pub status: String,
  pub indicators: Vec<String>,
  pub reason: String,
  pub entries_inspected: u32,
  pub expanded_bytes: u64,
  pub elapsed_ms: f64,
  pub uninspectable_format: Option<String>,
  pub analysis_blind_spots: Vec<String>,
}

pub(crate) struct Finding {
  pub(crate) uncertain: bool,
  pub(crate) indicators: Vec<String>,
  pub(crate) reason: String,
}

pub(crate) fn dedupe(values: Vec<String>) -> Vec<String> {
  let mut seen: Vec<String> = Vec::new();
  for value in values {
    if !seen.iter().any(|existing| existing == &value) {
      seen.push(value);
    }
  }
  seen
}

pub(crate) fn uncertain(reason: String, indicators: Vec<String>) -> Finding {
  Finding { uncertain: true, indicators, reason }
}

pub(crate) fn inspected(indicators: Vec<String>) -> Finding {
  let deduped = dedupe(indicators);
  let reason = if deduped.is_empty() {
    "arhiva inspectata pasiv fara indicatori interni".to_string()
  } else {
    "arhiva inspectata pasiv cu indicatori interni".to_string()
  };
  Finding { uncertain: false, indicators: deduped, reason }
}
