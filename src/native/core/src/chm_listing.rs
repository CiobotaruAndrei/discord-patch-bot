pub struct ChmListingLimits {
  pub max_entries: usize,
  pub max_name_bytes: usize,
  pub max_scan_bytes: usize
}

impl Default for ChmListingLimits {
  fn default() -> Self {
    Self { max_entries: 256, max_name_bytes: 512, max_scan_bytes: 4 * 1024 * 1024 }
  }
}

pub fn is_chm(bytes: &[u8]) -> bool {
  bytes.starts_with(b"ITSF")
}

fn read_encint(bytes: &[u8], cursor: &mut usize) -> Option<u64> {
  let mut value: u64 = 0;
  for _ in 0..10 {
    let byte = *bytes.get(*cursor)?;
    *cursor += 1;
    value = value.checked_mul(128)?.checked_add(u64::from(byte & 0x7f))?;
    if byte & 0x80 == 0 {
      return Some(value);
    }
  }
  None
}

pub fn list_chm_entries(bytes: &[u8], limits: &ChmListingLimits) -> Vec<String> {
  if !is_chm(bytes) {
    return Vec::new();
  }
  let window = &bytes[..bytes.len().min(limits.max_scan_bytes)];
  let mut names: Vec<String> = Vec::new();
  let mut chunk_start = 0usize;
  while chunk_start + 8 < window.len() && names.len() < limits.max_entries {
    let Some(relative) = window[chunk_start..].windows(4).position(|slice| slice == b"PMGL") else {
      break;
    };
    let mut cursor = chunk_start + relative + 20;
    let chunk_end = (chunk_start + relative + 4096).min(window.len());
    while cursor < chunk_end && names.len() < limits.max_entries {
      let Some(name_len) = read_encint(window, &mut cursor) else { break };
      if name_len == 0 || name_len as usize > limits.max_name_bytes || cursor + name_len as usize > chunk_end {
        break;
      }
      let raw = &window[cursor..cursor + name_len as usize];
      cursor += name_len as usize;
      let Ok(name) = std::str::from_utf8(raw) else { break };
      if !name.starts_with('/') {
        break;
      }
      if read_encint(window, &mut cursor).is_none() {
        break;
      }
      if read_encint(window, &mut cursor).is_none() {
        break;
      }
      if read_encint(window, &mut cursor).is_none() {
        break;
      }
      if !names.iter().any(|existing| existing == name) {
        names.push(name.to_string());
      }
    }
    chunk_start = chunk_start + relative + 4;
  }
  names
}

#[cfg(test)]
mod tests {
  use super::*;

  fn encint(mut value: u64) -> Vec<u8> {
    if value == 0 {
      return vec![0];
    }
    let mut parts: Vec<u8> = Vec::new();
    while value > 0 {
      parts.push((value % 128) as u8);
      value /= 128;
    }
    parts.reverse();
    let last = parts.len() - 1;
    for (index, part) in parts.iter_mut().enumerate() {
      if index != last {
        *part |= 0x80;
      }
    }
    parts
  }

  fn chm_cu_intrari(nume: &[&str]) -> Vec<u8> {
    let mut out = b"ITSF".to_vec();
    out.extend_from_slice(&[0u8; 60]);
    out.extend_from_slice(b"PMGL");
    out.extend_from_slice(&[0u8; 16]);
    for entry in nume {
      out.extend_from_slice(&encint(entry.len() as u64));
      out.extend_from_slice(entry.as_bytes());
      out.extend_from_slice(&encint(1));
      out.extend_from_slice(&encint(0));
      out.extend_from_slice(&encint(128));
    }
    out
  }

  #[test]
  fn intrarile_dintr_un_chm_sunt_listate_fara_decompresie() {
    let chm = chm_cu_intrari(&["/index.htm", "/script/rau.js", "/#SYSTEM"]);
    let entries = list_chm_entries(&chm, &ChmListingLimits::default());
    assert!(entries.iter().any(|name| name == "/index.htm"), "{entries:?}");
    assert!(entries.iter().any(|name| name == "/script/rau.js"), "{entries:?}");
  }

  #[test]
  fn un_fisier_care_nu_e_chm_nu_produce_intrari() {
    assert!(list_chm_entries(b"PK\x03\x04 nu e chm", &ChmListingLimits::default()).is_empty());
    assert!(list_chm_entries(b"", &ChmListingLimits::default()).is_empty());
  }

  #[test]
  fn numarul_de_intrari_e_plafonat() {
    let nume: Vec<String> = (0..500).map(|index| format!("/fisier{index}.htm")).collect();
    let refs: Vec<&str> = nume.iter().map(|entry| entry.as_str()).collect();
    let limits = ChmListingLimits { max_entries: 16, max_name_bytes: 512, max_scan_bytes: 4 * 1024 * 1024 };
    assert!(list_chm_entries(&chm_cu_intrari(&refs), &limits).len() <= 16);
  }

  #[test]
  fn un_nume_corupt_opreste_parcurgerea_fara_sa_crape() {
    let mut chm = b"ITSF".to_vec();
    chm.extend_from_slice(&[0u8; 60]);
    chm.extend_from_slice(b"PMGL");
    chm.extend_from_slice(&[0xffu8; 512]);
    let _ = list_chm_entries(&chm, &ChmListingLimits::default());
  }
}
