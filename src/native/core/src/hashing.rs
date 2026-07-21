use sha2::{Digest, Sha256};
use crate::text::normalize_title_for_dedupe;

pub fn stable_update_id(title: &str, link: &str) -> String {
  let base = format!("{}|{}", title, link);
  let mut hasher = Sha256::new();
  hasher.update(base.as_bytes());

  hex_encode(&hasher.finalize()[..8])
}

pub fn normalize_deal_state(sale_price: &str, normal_price: &str, savings: &str) -> String {
  [sale_price, normal_price, savings]
    .map(|value| value.trim().to_lowercase())
    .join(":")
}

#[allow(clippy::too_many_arguments)]
pub fn deal_hash(
  store: &str,
  steam_app_id: &str,
  id: &str,
  title: &str,
  sale_price: &str,
  normal_price: &str,
  savings: &str,
) -> String {
  let state = normalize_deal_state(sale_price, normal_price, savings);
  let stable_key = if store == "Steam" && !steam_app_id.is_empty() {
    format!("steam:{}:{}", steam_app_id, state)
  } else if store == "Epic Games" && !id.is_empty() {
    let raw_id = id.strip_prefix("epic_").unwrap_or(id);
    format!("epic:{}:{}", raw_id, state)
  } else {
    format!("{}:{}:{}", store, normalize_title_for_dedupe(title), state)
  };

  sha256_hex(&stable_key)
}

pub(crate) fn sha256_hex(value: &str) -> String {
  let mut hasher = Sha256::new();
  hasher.update(value.as_bytes());
  hex_encode(&hasher.finalize())
}

fn hex_encode(bytes: &[u8]) -> String {
  const HEX: &[u8; 16] = b"0123456789abcdef";
  let mut out = vec![0u8; bytes.len() * 2];
  for (i, &b) in bytes.iter().enumerate() {
    out[i * 2] = HEX[(b >> 4) as usize];
    out[i * 2 + 1] = HEX[(b & 0x0f) as usize];
  }

  unsafe { String::from_utf8_unchecked(out) }
}
