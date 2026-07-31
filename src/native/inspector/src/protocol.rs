use std::io::{self, Read, Write};

pub const PROTOCOL_VERSION: u16 = 2;
pub const MAX_FRAME_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_TEXT_BYTES: u32 = 4096;

#[derive(Debug)]
pub struct InspectionRequest {
  pub filename: String,
  pub mime: String,
  pub mode: String,
  pub max_depth: u32,
  pub max_entries: u32,
  pub max_expanded_bytes: u64,
  pub max_compression_ratio: f64,
  pub timeout_ms: u64,
  pub content: Vec<u8>,
}

#[derive(Debug)]
pub struct InspectionResponse {
  pub status: String,
  pub reason: String,
  pub indicators: Vec<String>,
  pub entries_inspected: u32,
  pub expanded_bytes: u64,
  pub elapsed_ms: f64,
  pub sandbox: bool,
  pub uninspectable_format: Option<String>,
  pub analysis_blind_spots: Vec<String>,
}

fn invalid(detail: &str) -> io::Error {
  io::Error::new(io::ErrorKind::InvalidData, detail.to_string())
}

fn read_exact(reader: &mut impl Read, buffer: &mut [u8]) -> io::Result<()> {
  reader.read_exact(buffer)
}

fn read_u16(reader: &mut impl Read) -> io::Result<u16> {
  let mut raw = [0u8; 2];
  read_exact(reader, &mut raw)?;
  Ok(u16::from_le_bytes(raw))
}

fn read_u32(reader: &mut impl Read) -> io::Result<u32> {
  let mut raw = [0u8; 4];
  read_exact(reader, &mut raw)?;
  Ok(u32::from_le_bytes(raw))
}

fn read_u64(reader: &mut impl Read) -> io::Result<u64> {
  let mut raw = [0u8; 8];
  read_exact(reader, &mut raw)?;
  Ok(u64::from_le_bytes(raw))
}

fn read_f64(reader: &mut impl Read) -> io::Result<f64> {
  let mut raw = [0u8; 8];
  read_exact(reader, &mut raw)?;
  Ok(f64::from_le_bytes(raw))
}

fn read_text(reader: &mut impl Read) -> io::Result<String> {
  let length = read_u32(reader)?;
  if length > MAX_TEXT_BYTES {
    return Err(invalid("camp text peste plafonul protocolului"));
  }
  let mut raw = vec![0u8; length as usize];
  read_exact(reader, &mut raw)?;
  String::from_utf8(raw).map_err(|_| invalid("camp text care nu e UTF-8 valid"))
}

fn write_text(writer: &mut impl Write, value: &str) -> io::Result<()> {
  let raw = value.as_bytes();
  let capped = &raw[..raw.len().min(MAX_TEXT_BYTES as usize)];
  writer.write_all(&(capped.len() as u32).to_le_bytes())?;
  writer.write_all(capped)
}

pub fn read_request(reader: &mut impl Read) -> io::Result<Option<InspectionRequest>> {
  let mut magic = [0u8; 4];
  match reader.read_exact(&mut magic) {
    Ok(()) => {}
    Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
    Err(error) => return Err(error),
  }
  if &magic != b"DPBI" {
    return Err(invalid("cadru fara semnatura DPBI"));
  }
  let version = read_u16(reader)?;
  if version != PROTOCOL_VERSION {
    return Err(invalid("versiune de protocol necunoscuta"));
  }
  let filename = read_text(reader)?;
  let mime = read_text(reader)?;
  let mode = read_text(reader)?;
  let max_depth = read_u32(reader)?;
  let max_entries = read_u32(reader)?;
  let max_expanded_bytes = read_u64(reader)?;
  let max_compression_ratio = read_f64(reader)?;
  let timeout_ms = read_u64(reader)?;
  let content_length = read_u64(reader)?;
  if content_length > MAX_FRAME_BYTES {
    return Err(invalid("continut peste plafonul protocolului"));
  }
  let mut content = vec![0u8; content_length as usize];
  read_exact(reader, &mut content)?;
  Ok(Some(InspectionRequest {
    filename,
    mime,
    mode,
    max_depth,
    max_entries,
    max_expanded_bytes,
    max_compression_ratio,
    timeout_ms,
    content,
  }))
}

pub fn write_request(writer: &mut impl Write, request: &InspectionRequest) -> io::Result<()> {
  writer.write_all(b"DPBI")?;
  writer.write_all(&PROTOCOL_VERSION.to_le_bytes())?;
  write_text(writer, &request.filename)?;
  write_text(writer, &request.mime)?;
  write_text(writer, &request.mode)?;
  writer.write_all(&request.max_depth.to_le_bytes())?;
  writer.write_all(&request.max_entries.to_le_bytes())?;
  writer.write_all(&request.max_expanded_bytes.to_le_bytes())?;
  writer.write_all(&request.max_compression_ratio.to_le_bytes())?;
  writer.write_all(&request.timeout_ms.to_le_bytes())?;
  writer.write_all(&(request.content.len() as u64).to_le_bytes())?;
  writer.write_all(&request.content)?;
  writer.flush()
}

pub fn write_response(writer: &mut impl Write, response: &InspectionResponse) -> io::Result<()> {
  writer.write_all(b"DPBO")?;
  writer.write_all(&PROTOCOL_VERSION.to_le_bytes())?;
  write_text(writer, &response.status)?;
  write_text(writer, &response.reason)?;
  writer.write_all(&(response.indicators.len() as u32).to_le_bytes())?;
  for indicator in &response.indicators {
    write_text(writer, indicator)?;
  }
  writer.write_all(&response.entries_inspected.to_le_bytes())?;
  writer.write_all(&response.expanded_bytes.to_le_bytes())?;
  writer.write_all(&response.elapsed_ms.to_le_bytes())?;
  writer.write_all(&[u8::from(response.sandbox)])?;
  match response.uninspectable_format.as_deref() {
    Some(format) => {
      writer.write_all(&[1u8])?;
      write_text(writer, format)?;
    }
    None => writer.write_all(&[0u8])?,
  }
  writer.write_all(&(response.analysis_blind_spots.len() as u32).to_le_bytes())?;
  for spot in &response.analysis_blind_spots {
    write_text(writer, spot)?;
  }
  writer.flush()
}

pub fn read_response(reader: &mut impl Read) -> io::Result<InspectionResponse> {
  let mut magic = [0u8; 4];
  read_exact(reader, &mut magic)?;
  if &magic != b"DPBO" {
    return Err(invalid("raspuns fara semnatura DPBO"));
  }
  let version = read_u16(reader)?;
  if version != PROTOCOL_VERSION {
    return Err(invalid("versiune de protocol necunoscuta in raspuns"));
  }
  let status = read_text(reader)?;
  let reason = read_text(reader)?;
  let count = read_u32(reader)?;
  if count > 1024 {
    return Err(invalid("prea multi indicatori in raspuns"));
  }
  let mut indicators = Vec::with_capacity(count as usize);
  for _ in 0..count {
    indicators.push(read_text(reader)?);
  }
  let entries_inspected = read_u32(reader)?;
  let expanded_bytes = read_u64(reader)?;
  let elapsed_ms = read_f64(reader)?;
  let mut sandbox = [0u8; 1];
  read_exact(reader, &mut sandbox)?;
  let mut present = [0u8; 1];
  read_exact(reader, &mut present)?;
  let uninspectable_format = if present[0] != 0 { Some(read_text(reader)?) } else { None };
  let spot_count = read_u32(reader)?;
  if spot_count > 1024 {
    return Err(invalid("prea multe puncte oarbe in raspuns"));
  }
  let mut analysis_blind_spots = Vec::with_capacity(spot_count as usize);
  for _ in 0..spot_count {
    analysis_blind_spots.push(read_text(reader)?);
  }
  Ok(InspectionResponse {
    status,
    reason,
    indicators,
    entries_inspected,
    expanded_bytes,
    elapsed_ms,
    sandbox: sandbox[0] != 0,
    uninspectable_format,
    analysis_blind_spots,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn sample() -> InspectionRequest {
    InspectionRequest {
      filename: "raport.pdf".to_string(),
      mime: "application/pdf".to_string(),
      mode: "document".to_string(),
      max_depth: 3,
      max_entries: 64,
      max_expanded_bytes: 8 * 1024 * 1024,
      max_compression_ratio: 100.0,
      timeout_ms: 100,
      content: b"%PDF-1.7 continut".to_vec(),
    }
  }

  #[test]
  fn a_request_survives_a_round_trip_byte_for_byte() {
    let request = sample();
    let mut buffer = Vec::new();
    write_request(&mut buffer, &request).unwrap();
    let decoded = read_request(&mut buffer.as_slice()).unwrap().expect("cadru complet");
    assert_eq!(decoded.filename, request.filename);
    assert_eq!(decoded.mime, request.mime);
    assert_eq!(decoded.mode, request.mode);
    assert_eq!(decoded.max_entries, request.max_entries);
    assert_eq!(decoded.timeout_ms, request.timeout_ms);
    assert_eq!(decoded.content, request.content);
  }

  #[test]
  fn a_response_survives_a_round_trip_inclusiv_starea_de_sandbox() {
    let response = InspectionResponse {
      status: "uncertain".to_string(),
      reason: "arhiva criptata".to_string(),
      indicators: vec!["executabil PE intern".to_string(), "arhiva criptata".to_string()],
      entries_inspected: 7,
      expanded_bytes: 4096,
      elapsed_ms: 12.5,
      sandbox: true,
      uninspectable_format: Some("rar-cu-header-criptat".to_string()),
      analysis_blind_spots: vec!["sectiune impachetata".to_string()],
    };
    let mut buffer = Vec::new();
    write_response(&mut buffer, &response).unwrap();
    let decoded = read_response(&mut buffer.as_slice()).unwrap();
    assert_eq!(decoded.status, "uncertain");
    assert_eq!(decoded.indicators.len(), 2);
    assert_eq!(decoded.entries_inspected, 7);
    assert!(decoded.sandbox, "starea sandbox-ului calatoreste explicit, nu se presupune");
    assert_eq!(
      decoded.uninspectable_format.as_deref(),
      Some("rar-cu-header-criptat"),
      "formatul neinspectat trece prin proces: altfel metricile de acoperire ar arata zero pe calea izolata"
    );
    assert_eq!(decoded.analysis_blind_spots, vec!["sectiune impachetata".to_string()]);
  }

  #[test]
  fn lipsa_formatului_neinspectat_nu_e_confundata_cu_un_format_gol() {
    let response = InspectionResponse {
      status: "inspected".to_string(),
      reason: "fara indicatori".to_string(),
      indicators: Vec::new(),
      entries_inspected: 1,
      expanded_bytes: 10,
      elapsed_ms: 1.0,
      sandbox: false,
      uninspectable_format: None,
      analysis_blind_spots: Vec::new(),
    };
    let mut buffer = Vec::new();
    write_response(&mut buffer, &response).unwrap();
    let decoded = read_response(&mut buffer.as_slice()).unwrap();
    assert!(decoded.uninspectable_format.is_none());
    assert!(decoded.analysis_blind_spots.is_empty());
  }

  #[test]
  fn stdin_inchis_inseamna_sfarsit_de_lucru_nu_eroare() {
    let empty: Vec<u8> = Vec::new();
    assert!(read_request(&mut empty.as_slice()).unwrap().is_none());
  }

  #[test]
  fn un_cadru_fara_semnatura_este_respins_inainte_de_orice_alocare() {
    let junk = b"XXXX rest de octeti".to_vec();
    let error = read_request(&mut junk.as_slice()).unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
  }

  #[test]
  fn un_continut_peste_plafon_este_respins_fara_sa_se_aloce_memoria_ceruta() {
    let mut frame = Vec::new();
    frame.extend_from_slice(b"DPBI");
    frame.extend_from_slice(&PROTOCOL_VERSION.to_le_bytes());
    for text in ["a", "b", "c"] {
      frame.extend_from_slice(&(text.len() as u32).to_le_bytes());
      frame.extend_from_slice(text.as_bytes());
    }
    frame.extend_from_slice(&3u32.to_le_bytes());
    frame.extend_from_slice(&64u32.to_le_bytes());
    frame.extend_from_slice(&1024u64.to_le_bytes());
    frame.extend_from_slice(&100.0f64.to_le_bytes());
    frame.extend_from_slice(&100u64.to_le_bytes());
    frame.extend_from_slice(&(MAX_FRAME_BYTES + 1).to_le_bytes());
    let error = read_request(&mut frame.as_slice()).unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
  }

  #[test]
  fn un_cadru_trunchiat_nu_e_confundat_cu_sfarsitul_curat_al_fluxului() {
    let request = sample();
    let mut buffer = Vec::new();
    write_request(&mut buffer, &request).unwrap();
    buffer.truncate(buffer.len() - 4);
    let error = read_request(&mut buffer.as_slice()).unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::UnexpectedEof);
  }
}
