pub fn levenshtein(a: &str, b: &str) -> usize {
  if a.is_empty() {
    return b.chars().count();
  }
  if b.is_empty() {
    return a.chars().count();
  }

  let a_chars: Vec<char> = a.chars().collect();
  let b_chars: Vec<char> = b.chars().collect();
  let mut row: Vec<usize> = (0..=b_chars.len()).collect();

  for (i, a_char) in a_chars.iter().enumerate() {
    let mut prev_diag = row[0];
    row[0] = i + 1;
    for (j, b_char) in b_chars.iter().enumerate() {
      let prev_above = row[j + 1];
      let insertion = row[j] + 1;
      let deletion = prev_above + 1;
      let substitution = prev_diag + usize::from(a_char != b_char);
      row[j + 1] = insertion.min(deletion).min(substitution);
      prev_diag = prev_above;
    }
  }

  row[b_chars.len()]
}

pub fn normalize_title_for_dedupe(value: &str) -> String {
  let mut normalized = String::with_capacity(value.len());
  let mut previous_was_space = false;

  for ch in value.to_lowercase().chars() {
    if matches!(ch, '\u{00ae}' | '\u{00a9}' | '\u{2122}') {
      continue;
    }
    if ch.is_ascii_alphanumeric() {
      normalized.push(ch);
      previous_was_space = false;
    } else if !previous_was_space {
      normalized.push(' ');
      previous_was_space = true;
    }
  }

  normalized.trim().to_string()
}

pub fn clean_text(input: &str) -> String {
  if input.is_empty() {
    return String::new();
  }
  let bytes = input.as_bytes();
  let mut out = String::with_capacity(input.len());
  let mut i = 0usize;
  let mut prev_was_space = true;

  while i < bytes.len() {
    let b = bytes[i];

    if b == b'<' {
      let mut j = i + 1;
      while j < bytes.len() && bytes[j] != b'>' {
        j += 1;
      }
      i = if j < bytes.len() { j + 1 } else { j };
      if !prev_was_space {
        out.push(' ');
        prev_was_space = true;
      }
      continue;
    }

    if b == b'&' {
      let max = std::cmp::min(bytes.len(), i + 8);
      let mut j = i + 1;
      while j < max && bytes[j] != b';' {
        j += 1;
      }
      if j < bytes.len() && bytes[j] == b';' {
        let entity_bytes = &bytes[i + 1..j];

        let replacement: Option<&str> = match entity_bytes {
          b if b.eq_ignore_ascii_case(b"nbsp") => Some(" "),
          b if b.eq_ignore_ascii_case(b"amp") => Some("&"),
          b if b.eq_ignore_ascii_case(b"quot") => Some("\""),
          b if b.eq_ignore_ascii_case(b"#39") || b.eq_ignore_ascii_case(b"apos") => Some("'"),
          b if b.eq_ignore_ascii_case(b"lt") => Some("<"),
          b if b.eq_ignore_ascii_case(b"gt") => Some(">"),
          _ => None,
        };
        if let Some(repl) = replacement {
          if repl == " " {
            if !prev_was_space {
              out.push(' ');
              prev_was_space = true;
            }
          } else {
            out.push_str(repl);
            prev_was_space = false;
          }
          i = j + 1;
          continue;
        }

        out.push_str(&input[i..=j]);
        prev_was_space = false;
        i = j + 1;
        continue;
      }

      out.push('&');
      prev_was_space = false;
      i += 1;
      continue;
    }

    if b.is_ascii_whitespace() {
      if !prev_was_space {
        out.push(' ');
        prev_was_space = true;
      }
      i += 1;
      continue;
    }

    if b < 0x80 {
      out.push(b as char);
      prev_was_space = false;
      i += 1;
    } else {
      let char_len = if b & 0xE0 == 0xC0 { 2 }
                     else if b & 0xF0 == 0xE0 { 3 }
                     else if b & 0xF8 == 0xF0 { 4 }
                     else { 1 };
      let end = std::cmp::min(bytes.len(), i + char_len);
      if let Ok(s) = std::str::from_utf8(&bytes[i..end]) {
        out.push_str(s);
      }
      prev_was_space = false;
      i = end;
    }
  }

  while out.ends_with(' ') {
    out.pop();
  }
  out
}

pub fn normalize_command_text(value: &str) -> String {
  value
    .to_lowercase()
    .chars()
    .map(|ch| if ch == '-' || ch == '_' { ' ' } else { ch })
    .collect::<String>()
    .trim()
    .to_string()
}

pub fn truncate_chars(value: &str, max_len: usize) -> String {
  if value.chars().count() <= max_len {
    return value.to_string();
  }
  value.chars().take(max_len).collect()
}
