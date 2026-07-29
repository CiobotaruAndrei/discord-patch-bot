

pub(crate) fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
  if needle.is_empty() || haystack.len() < needle.len() {
    return None;
  }
  haystack.windows(needle.len()).position(|window| window == needle)
}

pub(crate) fn contains(haystack: &[u8], needle: &[u8]) -> bool {
  find(haystack, needle).is_some()
}

pub(crate) fn is_word_byte(byte: u8) -> bool {
  byte.is_ascii_alphanumeric() || byte == b'_'
}

pub(crate) fn contains_with_trailing_boundary(haystack: &[u8], needle: &[u8]) -> bool {
  let mut offset = 0;
  while offset + needle.len() <= haystack.len() {
    match find(&haystack[offset..], needle) {
      None => return false,
      Some(index) => {
        let start = offset + index;
        let end = start + needle.len();
        if end >= haystack.len() || !is_word_byte(haystack[end]) {
          return true;
        }
        offset = start + 1;
      }
    }
  }
  false
}

pub(crate) fn contains_word(haystack: &[u8], needle: &[u8]) -> bool {
  let mut offset = 0;
  while offset + needle.len() <= haystack.len() {
    match find(&haystack[offset..], needle) {
      None => return false,
      Some(index) => {
        let start = offset + index;
        let end = start + needle.len();
        let leading_ok = start == 0 || !is_word_byte(haystack[start - 1]);
        let trailing_ok = end >= haystack.len() || !is_word_byte(haystack[end]);
        if leading_ok && trailing_ok {
          return true;
        }
        offset = start + 1;
      }
    }
  }
  false
}

pub(crate) fn hex_value(byte: u8) -> Option<u8> {
  match byte {
    b'0'..=b'9' => Some(byte - b'0'),
    b'a'..=b'f' => Some(byte - b'a' + 10),
    b'A'..=b'F' => Some(byte - b'A' + 10),
    _ => None,
  }
}

pub(crate) fn read_u16_le(bytes: &[u8], offset: usize) -> Option<u16> {
  if offset + 2 > bytes.len() { return None; }
  Some(u16::from_le_bytes([bytes[offset], bytes[offset + 1]]))
}

pub(crate) fn read_u32_le(bytes: &[u8], offset: usize) -> Option<u32> {
  if offset + 4 > bytes.len() { return None; }
  Some(u32::from_le_bytes([bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]]))
}

pub(crate) fn read_u64_le(bytes: &[u8], offset: usize) -> Option<u64> {
  if offset + 8 > bytes.len() { return None; }
  let mut buffer = [0u8; 8];
  buffer.copy_from_slice(&bytes[offset..offset + 8]);
  Some(u64::from_le_bytes(buffer))
}

pub(crate) fn scan_window(bytes: &[u8]) -> &[u8] {
  &bytes[..bytes.len().min(1_048_576)]
}

pub(crate) fn xml_attribute<'a>(element: &'a [u8], name: &[u8]) -> Option<&'a [u8]> {
  let mut offset = 0usize;
  while offset + name.len() <= element.len() {
    let window = &element[offset..];
    let position = window
      .windows(name.len())
      .position(|candidate| candidate.iter().zip(name.iter()).all(|(a, b)| a.to_ascii_lowercase() == *b))?;
    let start = offset + position;
    let leading_ok = start == 0 || !is_word_byte(element[start - 1]);
    let mut cursor = start + name.len();
    while cursor < element.len() && element[cursor].is_ascii_whitespace() {
      cursor += 1;
    }
    if leading_ok && cursor < element.len() && element[cursor] == b'=' {
      cursor += 1;
      while cursor < element.len() && element[cursor].is_ascii_whitespace() {
        cursor += 1;
      }
      if cursor < element.len() && (element[cursor] == b'"' || element[cursor] == b'\'') {
        let quote = element[cursor];
        cursor += 1;
        let end = element[cursor..].iter().position(|byte| *byte == quote)? + cursor;
        return Some(&element[cursor..end]);
      }
    }
    offset = start + 1;
  }
  None
}

pub(crate) fn ends_with_ci(haystack: &[u8], suffix: &[u8]) -> bool {
  haystack.len() >= suffix.len()
    && haystack[haystack.len() - suffix.len()..]
      .iter()
      .zip(suffix.iter())
      .all(|(a, b)| a.to_ascii_lowercase() == *b)
}

pub(crate) fn starts_with_ci(haystack: &[u8], prefix: &[u8]) -> bool {
  haystack.len() >= prefix.len()
    && haystack[..prefix.len()].iter().zip(prefix.iter()).all(|(a, b)| a.to_ascii_lowercase() == *b)
}

pub(crate) fn window_contains(haystack: &[u8], needle: &[u8]) -> bool {
  contains(haystack, needle)
}
