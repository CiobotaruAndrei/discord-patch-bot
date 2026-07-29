#![allow(non_upper_case_globals)]
#![allow(non_camel_case_types)]
#![allow(non_snake_case)]
#![allow(dead_code)]

include!(concat!(env!("OUT_DIR"), "/bindings.rs"));

extern "C" {
  pub fn discord_patch_bot_mspack_message(file: *mut mspack_file, format: *const ::std::os::raw::c_char, ...);
  pub fn discord_patch_bot_mspack_alloc(self_: *mut mspack_system, bytes: usize) -> *mut ::std::os::raw::c_void;
  pub fn discord_patch_bot_mspack_free(ptr: *mut ::std::os::raw::c_void);
  pub fn discord_patch_bot_mspack_copy(src: *mut ::std::os::raw::c_void, dest: *mut ::std::os::raw::c_void, bytes: usize);
}
