use std::os::raw::{c_char, c_int, c_uchar, c_uint};

extern "C" {
  pub fn discord_patch_bot_tlsh_digest(
    data: *const c_uchar,
    len: c_uint,
    out: *mut c_char,
    out_len: c_uint,
  ) -> c_int;
  pub fn discord_patch_bot_tlsh_diff(left: *const c_char, right: *const c_char) -> c_int;
  pub fn discord_patch_bot_tlsh_min_length() -> c_uint;
  pub fn discord_patch_bot_tlsh_digest_len() -> c_uint;
}
