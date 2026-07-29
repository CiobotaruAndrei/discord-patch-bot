pub struct ContainerDecodeLimits {
  pub max_entries: usize,
  pub max_entry_bytes: usize,
  pub max_total_bytes: usize,
  pub max_name_bytes: usize,
}

impl Default for ContainerDecodeLimits {
  fn default() -> Self {
    Self { max_entries: 128, max_entry_bytes: 4 * 1024 * 1024, max_total_bytes: 32 * 1024 * 1024, max_name_bytes: 512 }
  }
}

#[derive(Debug, PartialEq, Eq)]
pub struct DecodedEntry {
  pub name: String,
  pub declared_size: u64,
  pub bytes: Vec<u8>,
  pub truncated: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ContainerReport {
  pub format: String,
  pub entries: Vec<DecodedEntry>,
  pub truncated: bool,
}

#[derive(Debug)]
pub enum ContainerOutcome {
  Unavailable(String),
  NotContainer,
  Failed(String),
  Decoded(ContainerReport),
}

pub fn container_decode_available() -> bool {
  cfg!(feature = "mspack")
}

pub fn is_cabinet(bytes: &[u8]) -> bool {
  bytes.starts_with(b"MSCF")
}

pub fn is_compiled_help(bytes: &[u8]) -> bool {
  bytes.starts_with(b"ITSF")
}

pub fn looks_like_ms_container(bytes: &[u8]) -> bool {
  is_cabinet(bytes) || is_compiled_help(bytes)
}

#[cfg(feature = "mspack")]
mod engine {
  use super::{ContainerDecodeLimits, ContainerOutcome, ContainerReport, DecodedEntry};
  use super::{is_cabinet, is_compiled_help};
  use mspack_sys as ffi;
  use std::ffi::CStr;
  use std::os::raw::{c_char, c_int, c_void};
  use std::ptr;

  const INPUT_NAME: &[u8] = b"i\0";
  const OUTPUT_NAME: &[u8] = b"o\0";

  #[repr(C)]
  struct MemorySystem {
    system: ffi::mspack_system,
    input: *const u8,
    input_len: usize,
    output: Vec<u8>,
    max_output: usize,
    overflow: bool,
  }

  struct MemoryFile {
    owner: *mut MemorySystem,
    input: bool,
    position: usize,
  }

  unsafe extern "C" fn sys_open(
    self_: *mut ffi::mspack_system,
    filename: *const c_char,
    _mode: c_int,
  ) -> *mut ffi::mspack_file {
    if self_.is_null() || filename.is_null() {
      return ptr::null_mut();
    }
    let input = *filename == INPUT_NAME[0] as c_char;
    let handle = Box::new(MemoryFile { owner: self_ as *mut MemorySystem, input, position: 0 });
    Box::into_raw(handle) as *mut ffi::mspack_file
  }

  unsafe extern "C" fn sys_close(file: *mut ffi::mspack_file) {
    if !file.is_null() {
      drop(Box::from_raw(file as *mut MemoryFile));
    }
  }

  unsafe extern "C" fn sys_read(file: *mut ffi::mspack_file, buffer: *mut c_void, bytes: c_int) -> c_int {
    if file.is_null() || buffer.is_null() || bytes < 0 {
      return -1;
    }
    let handle = &mut *(file as *mut MemoryFile);
    if !handle.input {
      return -1;
    }
    let owner = &*handle.owner;
    let available = owner.input_len.saturating_sub(handle.position);
    let count = available.min(bytes as usize);
    if count > 0 {
      ptr::copy_nonoverlapping(owner.input.add(handle.position), buffer as *mut u8, count);
      handle.position += count;
    }
    count as c_int
  }

  unsafe extern "C" fn sys_write(file: *mut ffi::mspack_file, buffer: *mut c_void, bytes: c_int) -> c_int {
    if file.is_null() || buffer.is_null() || bytes < 0 {
      return -1;
    }
    let handle = &mut *(file as *mut MemoryFile);
    if handle.input {
      return -1;
    }
    let owner = &mut *handle.owner;
    let requested = bytes as usize;
    let room = owner.max_output.saturating_sub(owner.output.len());
    let stored = room.min(requested);
    if stored > 0 {
      let start = owner.output.len();
      owner.output.resize(start + stored, 0);
      ptr::copy_nonoverlapping(buffer as *const u8, owner.output.as_mut_ptr().add(start), stored);
    }
    if stored < requested {
      owner.overflow = true;
    }
    handle.position = owner.output.len();
    bytes
  }

  unsafe extern "C" fn sys_seek(file: *mut ffi::mspack_file, offset: ffi::off_t, mode: c_int) -> c_int {
    if file.is_null() {
      return -1;
    }
    let handle = &mut *(file as *mut MemoryFile);
    let owner = &*handle.owner;
    let length = if handle.input { owner.input_len } else { owner.output.len() };
    let base = match mode as u32 {
      ffi::MSPACK_SYS_SEEK_START => 0i64,
      ffi::MSPACK_SYS_SEEK_CUR => handle.position as i64,
      ffi::MSPACK_SYS_SEEK_END => length as i64,
      _ => return -1,
    };
    let Some(target) = base.checked_add(offset as i64) else { return -1 };
    if target < 0 || target > length as i64 {
      return -1;
    }
    handle.position = target as usize;
    0
  }

  unsafe extern "C" fn sys_tell(file: *mut ffi::mspack_file) -> ffi::off_t {
    if file.is_null() {
      return -1;
    }
    let handle = &*(file as *mut MemoryFile);
    handle.position as ffi::off_t
  }

  impl MemorySystem {
    fn new(input: &[u8], max_output: usize) -> Box<Self> {
      Box::new(MemorySystem {
        system: ffi::mspack_system {
          open: Some(sys_open),
          close: Some(sys_close),
          read: Some(sys_read),
          write: Some(sys_write),
          seek: Some(sys_seek),
          tell: Some(sys_tell),
          message: Some(ffi::discord_patch_bot_mspack_message),
          alloc: Some(ffi::discord_patch_bot_mspack_alloc),
          free: Some(ffi::discord_patch_bot_mspack_free),
          copy: Some(ffi::discord_patch_bot_mspack_copy),
          null_ptr: ptr::null_mut(),
        },
        input: input.as_ptr(),
        input_len: input.len(),
        output: Vec::new(),
        max_output,
        overflow: false,
      })
    }
  }

  fn entry_name(raw: *const c_char, max_bytes: usize) -> String {
    if raw.is_null() {
      return "<fara nume>".to_string();
    }
    let bytes = unsafe { CStr::from_ptr(raw) }.to_bytes();
    String::from_utf8_lossy(&bytes[..bytes.len().min(max_bytes)]).into_owned()
  }

  unsafe fn decode_cabinet(bytes: &[u8], limits: &ContainerDecodeLimits) -> ContainerOutcome {
    let mut memory = MemorySystem::new(bytes, limits.max_entry_bytes);
    let decompressor = ffi::mspack_create_cab_decompressor(&mut memory.system);
    if decompressor.is_null() {
      return ContainerOutcome::Failed("libmspack nu a putut crea decompresorul CAB".to_string());
    }

    let mut report = ContainerReport { format: "CAB".to_string(), entries: Vec::new(), truncated: false };
    let open = (*decompressor).open;
    let close = (*decompressor).close;
    let extract = (*decompressor).extract;

    if let (Some(open), Some(close), Some(extract)) = (open, close, extract) {
      let cabinet = open(decompressor, INPUT_NAME.as_ptr() as *const c_char);
      if cabinet.is_null() {
        ffi::mspack_destroy_cab_decompressor(decompressor);
        return ContainerOutcome::Failed("libmspack nu a putut deschide cabinetul".to_string());
      }

      let mut total = 0usize;
      let mut file = (*cabinet).files;
      while !file.is_null() {
        if report.entries.len() >= limits.max_entries || total >= limits.max_total_bytes {
          report.truncated = true;
          break;
        }
        memory.output.clear();
        memory.overflow = false;
        let status = extract(decompressor, file, OUTPUT_NAME.as_ptr() as *const c_char);
        let name = entry_name((*file).filename, limits.max_name_bytes);
        if status == ffi::MSPACK_ERR_OK as c_int {
          total += memory.output.len();
          report.entries.push(DecodedEntry {
            name,
            declared_size: u64::from((*file).length),
            bytes: std::mem::take(&mut memory.output),
            truncated: memory.overflow,
          });
        } else {
          report.truncated = true;
        }
        file = (*file).next;
      }

      close(decompressor, cabinet);
    }

    ffi::mspack_destroy_cab_decompressor(decompressor);
    ContainerOutcome::Decoded(report)
  }

  unsafe fn decode_compiled_help(bytes: &[u8], limits: &ContainerDecodeLimits) -> ContainerOutcome {
    let mut memory = MemorySystem::new(bytes, limits.max_entry_bytes);
    let decompressor = ffi::mspack_create_chm_decompressor(&mut memory.system);
    if decompressor.is_null() {
      return ContainerOutcome::Failed("libmspack nu a putut crea decompresorul CHM".to_string());
    }

    let mut report = ContainerReport { format: "CHM".to_string(), entries: Vec::new(), truncated: false };
    let open = (*decompressor).open;
    let close = (*decompressor).close;
    let extract = (*decompressor).extract;

    if let (Some(open), Some(close), Some(extract)) = (open, close, extract) {
      let header = open(decompressor, INPUT_NAME.as_ptr() as *const c_char);
      if header.is_null() {
        ffi::mspack_destroy_chm_decompressor(decompressor);
        return ContainerOutcome::Failed("libmspack nu a putut deschide ajutorul compilat".to_string());
      }

      let mut total = 0usize;
      let mut file = (*header).files;
      while !file.is_null() {
        if report.entries.len() >= limits.max_entries || total >= limits.max_total_bytes {
          report.truncated = true;
          break;
        }
        memory.output.clear();
        memory.overflow = false;
        let status = extract(decompressor, file, OUTPUT_NAME.as_ptr() as *const c_char);
        let name = entry_name((*file).filename, limits.max_name_bytes);
        if status == ffi::MSPACK_ERR_OK as c_int {
          total += memory.output.len();
          report.entries.push(DecodedEntry {
            name,
            declared_size: (*file).length as u64,
            bytes: std::mem::take(&mut memory.output),
            truncated: memory.overflow,
          });
        } else {
          report.truncated = true;
        }
        file = (*file).next;
      }

      close(decompressor, header);
    }

    ffi::mspack_destroy_chm_decompressor(decompressor);
    ContainerOutcome::Decoded(report)
  }

  pub fn decode(bytes: &[u8], limits: &ContainerDecodeLimits) -> ContainerOutcome {
    if is_cabinet(bytes) {
      unsafe { decode_cabinet(bytes, limits) }
    } else if is_compiled_help(bytes) {
      unsafe { decode_compiled_help(bytes, limits) }
    } else {
      ContainerOutcome::NotContainer
    }
  }
}

#[cfg(not(feature = "mspack"))]
mod engine {
  use super::{ContainerDecodeLimits, ContainerOutcome};

  pub fn decode(bytes: &[u8], _limits: &ContainerDecodeLimits) -> ContainerOutcome {
    if !super::looks_like_ms_container(bytes) {
      return ContainerOutcome::NotContainer;
    }
    ContainerOutcome::Unavailable(
      "decodarea containerelor Microsoft nu este compilata in acest build (feature `mspack` dezactivat)".to_string(),
    )
  }
}

pub fn decode_ms_container(bytes: &[u8], limits: &ContainerDecodeLimits) -> ContainerOutcome {
  engine::decode(bytes, limits)
}
