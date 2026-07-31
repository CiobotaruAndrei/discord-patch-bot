use discord_patch_bot_logic as logic;
use napi::bindgen_prelude::{AsyncTask, Buffer, Env, Task};
use napi_derive::napi;

#[napi(object)]
pub struct YaraMatchJs {
  pub rule: String,
  pub namespace: String,
  pub tags: Vec<String>,
  pub severity: String,
  pub description: String,
}

#[napi(object)]
pub struct YaraScanReportJs {
  pub status: String,
  pub reason: String,
  pub ruleset_id: String,
  pub matches: Vec<YaraMatchJs>,
  pub truncated: bool,
}

#[napi(object)]
pub struct YaraRulesetInfoJs {
  pub ruleset_id: String,
  pub rule_count: u32,
  pub loaded: bool,
  pub available: bool,
}

#[napi]
pub fn load_yara_rules(source: String) -> napi::Result<YaraRulesetInfoJs> {
  match logic::load_yara_rules(&source) {
    Ok(info) => Ok(YaraRulesetInfoJs {
      ruleset_id: info.ruleset_id,
      rule_count: info.rule_count,
      loaded: info.loaded,
      available: logic::yara_available(),
    }),
    Err(error) => Err(napi::Error::from_reason(error)),
  }
}

#[napi]
pub fn yara_ruleset_info() -> YaraRulesetInfoJs {
  let info = logic::yara_ruleset_info();
  YaraRulesetInfoJs {
    ruleset_id: info.ruleset_id,
    rule_count: info.rule_count,
    loaded: info.loaded,
    available: logic::yara_available(),
  }
}

pub struct ScanYaraTask {
  bytes: Vec<u8>,
  timeout_ms: u32,
  max_matches: u32,
}

impl Task for ScanYaraTask {
  type Output = logic::YaraScanReport;
  type JsValue = YaraScanReportJs;

  fn compute(&mut self) -> napi::Result<Self::Output> {
    Ok(logic::scan_yara(&self.bytes, self.timeout_ms, self.max_matches))
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
    Ok(YaraScanReportJs {
      status: output.status,
      reason: output.reason,
      ruleset_id: output.ruleset_id,
      matches: output
        .matches
        .into_iter()
        .map(|found| YaraMatchJs {
          rule: found.rule,
          namespace: found.namespace,
          tags: found.tags,
          severity: found.severity,
          description: found.description,
        })
        .collect(),
      truncated: output.truncated,
    })
  }
}

#[napi(ts_return_type = "Promise<YaraScanReportJs>")]
pub fn scan_yara(bytes: Buffer, timeout_ms: u32, max_matches: u32) -> AsyncTask<ScanYaraTask> {
  AsyncTask::new(ScanYaraTask { bytes: bytes.to_vec(), timeout_ms, max_matches })
}
