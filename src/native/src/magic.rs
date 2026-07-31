use discord_patch_bot_logic as logic;
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

#[napi(object)]
pub struct MagicReportJs {
  pub mime: String,
  pub description: String,
  pub encoding: String,
  pub kind: String,
  pub extension_mime: String,
  pub declared_mime: String,
  pub mismatch_flags: u32,
}

#[napi]
pub fn inspect_magic(bytes: Buffer, filename: String, declared_mime: String) -> MagicReportJs {
  let report = logic::inspect_magic(&bytes, &filename, &declared_mime);
  MagicReportJs {
    mime: report.mime,
    description: report.description,
    encoding: report.encoding,
    kind: report.kind,
    extension_mime: report.extension_mime,
    declared_mime: report.declared_mime,
    mismatch_flags: report.mismatch_flags,
  }
}
