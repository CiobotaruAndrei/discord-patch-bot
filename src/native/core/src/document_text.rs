pub struct DocumentTextLimits {
  pub max_text_bytes: usize,
  pub max_hosts: usize
}

impl Default for DocumentTextLimits {
  fn default() -> Self {
    Self { max_text_bytes: 256 * 1024, max_hosts: 32 }
  }
}

pub fn extract_pdf_text(content: &[u8], limits: &DocumentTextLimits) -> String {
  let mut out = String::new();
  let mut cursor = 0usize;
  while cursor < content.len() && out.len() < limits.max_text_bytes {
    match content[cursor] {
      b'(' => {
        cursor += 1;
        let mut depth = 1usize;
        while cursor < content.len() && depth > 0 && out.len() < limits.max_text_bytes {
          match content[cursor] {
            b'\\' => {
              cursor += 1;
              if cursor < content.len() {
                let escaped = content[cursor];
                if !escaped.is_ascii_digit() {
                  out.push(escaped as char);
                }
                cursor += 1;
              }
            }
            b'(' => {
              depth += 1;
              out.push('(');
              cursor += 1;
            }
            b')' => {
              depth -= 1;
              if depth > 0 {
                out.push(')');
              }
              cursor += 1;
            }
            other => {
              out.push(other as char);
              cursor += 1;
            }
          }
        }
        out.push(' ');
      }
      b'<' if cursor + 1 < content.len() && content[cursor + 1] != b'<' => {
        cursor += 1;
        let mut nibbles: Vec<u8> = Vec::new();
        while cursor < content.len() && content[cursor] != b'>' {
          let digit = content[cursor];
          if digit.is_ascii_hexdigit() {
            nibbles.push(digit);
          }
          cursor += 1;
        }
        cursor += 1;
        for pereche in nibbles.chunks(2) {
          if pereche.len() < 2 || out.len() >= limits.max_text_bytes {
            break;
          }
          let text = std::str::from_utf8(pereche).unwrap_or("");
          if let Ok(value) = u8::from_str_radix(text, 16) {
            if value != 0 {
              out.push(value as char);
            }
          }
        }
        out.push(' ');
      }
      _ => cursor += 1
    }
  }
  out
}

fn host_din_url(rest: &str) -> Option<String> {
  let host: String = rest
    .chars()
    .take_while(|character| !matches!(character, '/' | '?' | '#' | ' ' | ')' | '>' | '"' | '\'' | ',' | '\\'))
    .collect();
  let host = host.split('@').next_back().unwrap_or("").trim_end_matches('.');
  let host = host.split(':').next().unwrap_or("");
  if host.is_empty() || !host.contains('.') || host.len() > 253 {
    return None;
  }
  Some(host.to_lowercase())
}

pub fn find_url_hosts(text: &str, limits: &DocumentTextLimits) -> Vec<String> {
  const SCHEMES: &[&str] = &["https://", "http://", "ftp://"];
  let lower = text.to_lowercase();
  let mut hosts: Vec<String> = Vec::new();
  let mut cursor = 0usize;
  while cursor < lower.len() && hosts.len() < limits.max_hosts {
    let Some((position, scheme)) = SCHEMES
      .iter()
      .filter_map(|scheme| lower[cursor..].find(scheme).map(|at| (cursor + at, *scheme)))
      .min_by_key(|(at, _)| *at)
    else {
      break;
    };
    let start = position + scheme.len();
    if let Some(host) = host_din_url(&text[start.min(text.len())..]) {
      if !hosts.contains(&host) {
        hosts.push(host);
      }
    }
    cursor = start.max(cursor + 1);
  }
  hosts
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn textul_literal_si_cel_hexazecimal_sunt_amandoua_extrase() {
    let limits = DocumentTextLimits::default();
    let literal = extract_pdf_text(b"BT /F1 12 Tf (buna ziua) Tj ET", &limits);
    assert!(literal.contains("buna ziua"));

    let hexa = extract_pdf_text(b"BT <62756E61> Tj ET", &limits);
    assert!(hexa.contains("buna"), "sirurile hexazecimale sunt tot text vizibil: {hexa:?}");
  }

  #[test]
  fn parantezele_imbricate_si_evadate_nu_rup_extragerea() {
    let limits = DocumentTextLimits::default();
    let text = extract_pdf_text(br"((imbricat) si \(evadat\)) Tj", &limits);
    assert!(text.contains("imbricat"), "text: {text:?}");
    assert!(text.contains("evadat"), "text: {text:?}");
  }

  #[test]
  fn gazdele_sunt_extrase_fara_port_utilizator_sau_punctuatie() {
    let limits = DocumentTextLimits::default();
    assert_eq!(find_url_hosts("mergi pe https://exemplu.test/verify acum", &limits), vec!["exemplu.test"]);
    assert_eq!(find_url_hosts("http://user@banca.test:8080/x", &limits), vec!["banca.test"]);
    assert_eq!(find_url_hosts("(https://a.test)", &limits), vec!["a.test"]);
  }

  #[test]
  fn textul_fara_adrese_nu_produce_gazde() {
    let limits = DocumentTextLimits::default();
    assert!(find_url_hosts("doar un text obisnuit, fara linkuri", &limits).is_empty());
    assert!(find_url_hosts("https://fara-punct/x", &limits).is_empty(), "un host fara punct nu e domeniu");
  }

  #[test]
  fn extragerea_respecta_plafonul_de_text() {
    let limits = DocumentTextLimits { max_text_bytes: 16, max_hosts: 32 };
    let mut mare = b"(".to_vec();
    mare.extend_from_slice(&vec![b'a'; 4096]);
    mare.extend_from_slice(b") Tj");
    assert!(extract_pdf_text(&mare, &limits).len() <= 32);
  }
}
