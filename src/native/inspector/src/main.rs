use discord_patch_bot_logic::{inspect_untrusted_content, InspectionLimits};
use native_inspector::protocol::{read_request, write_response, InspectionResponse};
use native_inspector::sandbox::{describe, engage_sandbox, SandboxOutcome};
use std::io::{self, BufReader, BufWriter, Write};

fn warm_up() {
  let probe = b"PK\x03\x04 incalzire";
  let _ = inspect_untrusted_content(probe, "incalzire.zip", "application/zip", "archive", InspectionLimits::default());
}

fn main() -> io::Result<()> {
  let stdin = io::stdin();
  let stdout = io::stdout();
  let mut reader = BufReader::new(stdin.lock());
  let mut writer = BufWriter::new(stdout.lock());

  warm_up();

  let outcome = engage_sandbox();
  eprintln!("native-inspector: {}", describe(&outcome));
  let sandbox = match outcome {
    SandboxOutcome::Engaged => true,
    SandboxOutcome::Unsupported(_) => false,
    SandboxOutcome::Failed(detail) => return Err(io::Error::other(detail)),
  };

  writer.write_all(b"DPBR")?;
  writer.write_all(&[u8::from(sandbox)])?;
  writer.flush()?;

  loop {
    let request = match read_request(&mut reader) {
      Ok(Some(request)) => request,
      Ok(None) => return Ok(()),
      Err(error) => return Err(error),
    };
    let limits = InspectionLimits {
      max_depth: request.max_depth,
      max_entries: request.max_entries,
      max_expanded_bytes: request.max_expanded_bytes,
      max_compression_ratio: request.max_compression_ratio,
      timeout_ms: request.timeout_ms,
    };
    let report = inspect_untrusted_content(&request.content, &request.filename, &request.mime, &request.mode, limits);
    write_response(
      &mut writer,
      &InspectionResponse {
        status: report.status,
        reason: report.reason,
        indicators: report.indicators,
        entries_inspected: report.entries_inspected,
        expanded_bytes: report.expanded_bytes,
        elapsed_ms: report.elapsed_ms,
        sandbox,
        uninspectable_format: report.uninspectable_format,
        analysis_blind_spots: report.analysis_blind_spots,
      },
    )?;
  }
}
