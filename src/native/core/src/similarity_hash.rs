pub struct FuzzyMatchLimits {
  pub max_input_bytes: usize,
  pub near_distance: i32,
  pub related_distance: i32,
}

impl Default for FuzzyMatchLimits {
  fn default() -> Self {
    Self { max_input_bytes: 8 * 1024 * 1024, near_distance: 30, related_distance: 100 }
  }
}

pub fn fuzzy_hashing_available() -> bool {
  cfg!(feature = "fuzzy")
}

#[cfg(feature = "fuzzy")]
mod engine {
  use std::ffi::{CStr, CString};
  use std::os::raw::{c_char, c_uint};

  pub fn min_input_bytes() -> usize {
    unsafe { tlsh_sys::discord_patch_bot_tlsh_min_length() as usize }
  }

  pub fn digest_len() -> usize {
    unsafe { tlsh_sys::discord_patch_bot_tlsh_digest_len() as usize }
  }

  pub fn digest(bytes: &[u8]) -> Option<String> {
    let mut buffer = vec![0u8; digest_len() + 2];
    let status = unsafe {
      tlsh_sys::discord_patch_bot_tlsh_digest(
        bytes.as_ptr(),
        bytes.len() as c_uint,
        buffer.as_mut_ptr().cast::<c_char>(),
        buffer.len() as c_uint,
      )
    };
    if status != 0 {
      return None;
    }
    let text = CStr::from_bytes_until_nul(&buffer).ok()?;
    let text = text.to_str().ok()?;
    (!text.is_empty()).then(|| text.to_string())
  }

  pub fn distance(left: &str, right: &str) -> Option<i32> {
    let left = CString::new(left).ok()?;
    let right = CString::new(right).ok()?;
    let value = unsafe { tlsh_sys::discord_patch_bot_tlsh_diff(left.as_ptr(), right.as_ptr()) };
    (value >= 0).then_some(value)
  }
}

#[cfg(not(feature = "fuzzy"))]
mod engine {
  pub fn min_input_bytes() -> usize {
    usize::MAX
  }

  pub fn digest_len() -> usize {
    0
  }

  pub fn digest(_bytes: &[u8]) -> Option<String> {
    None
  }

  pub fn distance(_left: &str, _right: &str) -> Option<i32> {
    None
  }
}

pub fn min_fuzzy_input_bytes() -> usize {
  engine::min_input_bytes()
}

pub fn fuzzy_digest_len() -> usize {
  engine::digest_len()
}

pub fn fuzzy_digest(bytes: &[u8], limits: &FuzzyMatchLimits) -> Option<String> {
  let window = &bytes[..bytes.len().min(limits.max_input_bytes)];
  if window.len() < min_fuzzy_input_bytes() {
    return None;
  }
  engine::digest(window)
}

pub fn fuzzy_distance(left: &str, right: &str) -> Option<i32> {
  engine::distance(left, right)
}

#[derive(Debug, PartialEq, Eq)]
pub enum Proximity {
  Near,
  Related,
}

pub fn classify_distance(distance: i32, limits: &FuzzyMatchLimits) -> Option<Proximity> {
  if distance <= limits.near_distance {
    Some(Proximity::Near)
  } else if distance <= limits.related_distance {
    Some(Proximity::Related)
  } else {
    None
  }
}
