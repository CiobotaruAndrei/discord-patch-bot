pub struct NativeArchiveEntry {
  pub name: String,
  pub size: u64,
  pub encrypted: bool,
  pub directory: bool,
  pub link: bool,
  pub unsafe_path: bool,
}

pub enum NativeArchiveOutcome {
  Unavailable(String),
  Failed(String),
  Decoded { entries: u32, format: String },
}

pub fn native_archive_available() -> bool {
  cfg!(feature = "archive")
}

fn has_unsafe_path(name: &str) -> bool {
  let normalized = name.replace('\\', "/");
  normalized.starts_with('/')
    || normalized.starts_with("../")
    || normalized.contains("/../")
    || normalized == ".."
    || (normalized.len() >= 2 && normalized.as_bytes()[1] == b':')
}

#[cfg(feature = "archive")]
mod engine {
  use super::*;
  use libarchive2_sys as sys;
  use std::ffi::CStr;
  use std::os::raw::c_void;

  const ARCHIVE_OK: i32 = 0;
  const ARCHIVE_EOF: i32 = 1;

  struct ArchiveHandle(*mut sys::archive);

  impl Drop for ArchiveHandle {
    fn drop(&mut self) {
      if !self.0.is_null() {
        unsafe {
          sys::archive_read_close(self.0);
          sys::archive_read_free(self.0);
        }
      }
    }
  }

  fn last_error(handle: *mut sys::archive) -> String {
    let raw = unsafe { sys::archive_error_string(handle) };
    if raw.is_null() {
      return "eroare libarchive necunoscuta".to_string();
    }
    unsafe { CStr::from_ptr(raw) }.to_string_lossy().into_owned()
  }

  fn entry_name(entry: *mut sys::archive_entry) -> String {
    let raw = unsafe { sys::archive_entry_pathname(entry) };
    if raw.is_null() {
      return String::new();
    }
    unsafe { CStr::from_ptr(raw) }.to_string_lossy().into_owned()
  }

  fn format_name(handle: *mut sys::archive) -> String {
    let raw = unsafe { sys::archive_format_name(handle) };
    if raw.is_null() {
      return "necunoscut".to_string();
    }
    unsafe { CStr::from_ptr(raw) }.to_string_lossy().into_owned()
  }

  pub fn decode<F>(bytes: &[u8], max_entry_bytes: u64, mut on_entry: F) -> NativeArchiveOutcome
  where
    F: FnMut(NativeArchiveEntry, &[u8]) -> bool,
  {
    let handle = ArchiveHandle(unsafe { sys::archive_read_new() });
    if handle.0.is_null() {
      return NativeArchiveOutcome::Failed("libarchive nu a putut aloca un cititor".to_string());
    }
    unsafe {
      sys::archive_read_support_filter_all(handle.0);
      sys::archive_read_support_format_all(handle.0);
    }
    let opened = unsafe { sys::archive_read_open_memory(handle.0, bytes.as_ptr() as *mut c_void, bytes.len()) };
    if opened != ARCHIVE_OK {
      return NativeArchiveOutcome::Failed(last_error(handle.0));
    }

    let mut entries = 0u32;
    let mut format = String::new();
    loop {
      let mut entry: *mut sys::archive_entry = std::ptr::null_mut();
      let status = unsafe { sys::archive_read_next_header(handle.0, &mut entry) };
      if status == ARCHIVE_EOF {
        break;
      }
      if status != ARCHIVE_OK || entry.is_null() {
        return NativeArchiveOutcome::Failed(last_error(handle.0));
      }
      if format.is_empty() {
        format = format_name(handle.0);
      }

      let name = entry_name(entry);
      let declared = unsafe { sys::archive_entry_size(entry) };
      let filetype = unsafe { sys::archive_entry_filetype(entry) };
      let encrypted = unsafe { sys::archive_entry_is_encrypted(entry) } != 0;
      let symlink = unsafe { !sys::archive_entry_symlink(entry).is_null() };
      let hardlink = unsafe { !sys::archive_entry_hardlink(entry).is_null() };
      let descriptor = NativeArchiveEntry {
        unsafe_path: has_unsafe_path(&name),
        name,
        size: if declared > 0 { declared as u64 } else { 0 },
        encrypted,
        directory: filetype == 0o040000,
        link: symlink || hardlink,
      };

      let mut payload: Vec<u8> = Vec::new();
      if !descriptor.directory && !descriptor.link && !descriptor.encrypted {
        let mut chunk = vec![0u8; 64 * 1024];
        loop {
          let read = unsafe {
            sys::archive_read_data(handle.0, chunk.as_mut_ptr() as *mut c_void, chunk.len())
          };
          if read == 0 {
            break;
          }
          if read < 0 {
            return NativeArchiveOutcome::Failed(last_error(handle.0));
          }
          let taken = read as usize;
          if payload.len() as u64 + taken as u64 > max_entry_bytes {
            payload.extend_from_slice(&chunk[..taken.min((max_entry_bytes as usize).saturating_sub(payload.len()))]);
            break;
          }
          payload.extend_from_slice(&chunk[..taken]);
        }
      }

      entries += 1;
      if !on_entry(descriptor, &payload) {
        return NativeArchiveOutcome::Decoded { entries, format };
      }
    }

    if format.is_empty() {
      format = format_name(handle.0);
    }
    NativeArchiveOutcome::Decoded { entries, format }
  }
}

#[cfg(not(feature = "archive"))]
mod engine {
  use super::*;

  pub fn decode<F>(_bytes: &[u8], _max_entry_bytes: u64, _on_entry: F) -> NativeArchiveOutcome
  where
    F: FnMut(NativeArchiveEntry, &[u8]) -> bool,
  {
    NativeArchiveOutcome::Unavailable(
      "decodorul libarchive nu este compilat in acest build (feature `archive` dezactivat)".to_string(),
    )
  }
}

pub fn decode_native_archive<F>(bytes: &[u8], max_entry_bytes: u64, on_entry: F) -> NativeArchiveOutcome
where
  F: FnMut(NativeArchiveEntry, &[u8]) -> bool,
{
  engine::decode(bytes, max_entry_bytes, on_entry)
}

#[cfg(all(test, feature = "archive"))]
pub(crate) fn write_test_archive(format: &str, entries: &[(&str, &[u8])]) -> Vec<u8> {
  use libarchive2_sys as sys;
  use std::ffi::CString;
  use std::os::raw::c_void;

  let mut buffer = vec![0u8; 1024 * 1024];
  let mut used: usize = 0;
  unsafe {
    let handle = sys::archive_write_new();
    assert!(!handle.is_null());
    match format {
      "7z" => sys::archive_write_set_format_7zip(handle),
      "zip" => sys::archive_write_set_format_zip(handle),
      _ => sys::archive_write_set_format_pax_restricted(handle),
    };
    assert_eq!(
      sys::archive_write_open_memory(handle, buffer.as_mut_ptr() as *mut c_void, buffer.len(), &mut used),
      0
    );
    for (name, payload) in entries {
      let entry = sys::archive_entry_new();
      let path = CString::new(*name).unwrap();
      sys::archive_entry_set_pathname(entry, path.as_ptr());
      sys::archive_entry_set_size(entry, payload.len() as i64);
      sys::archive_entry_set_filetype(entry, 0o100000);
      sys::archive_entry_set_perm(entry, 0o644);
      assert_eq!(sys::archive_write_header(handle, entry), 0);
      if !payload.is_empty() {
        let written = sys::archive_write_data(handle, payload.as_ptr() as *const c_void, payload.len());
        assert!(written >= 0 && written as usize == payload.len());
      }
      sys::archive_entry_free(entry);
    }
    sys::archive_write_close(handle);
    sys::archive_write_free(handle);
  }
  buffer.truncate(used);
  buffer
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn unsafe_paths_are_recognised_without_touching_the_filesystem() {
    assert!(has_unsafe_path("/etc/passwd"));
    assert!(has_unsafe_path("../fuge-din-arhiva"));
    assert!(has_unsafe_path("docs/../../afara"));
    assert!(has_unsafe_path("C:\\Windows\\system32\\evil.dll"));
    assert!(!has_unsafe_path("docs/readme.txt"));
    assert!(!has_unsafe_path("a..b/normal.txt"));
  }

  #[cfg(feature = "archive")]
  #[test]
  fn a_real_seven_zip_archive_is_decoded_entry_by_entry() {
    let mut pe = vec![0x4du8, 0x5a, 0x90, 0x00];
    pe.extend(std::iter::repeat_n(0x41u8, 256));
    let archive = write_test_archive("7z", &[("docs/readme.txt", b"text simplu"), ("setup/installer.exe", &pe)]);
    assert!(archive.len() > 32, "arhiva de test a fost scrisa de libarchive");

    let mut seen: Vec<(String, usize)> = Vec::new();
    let outcome = decode_native_archive(&archive, 8 * 1024 * 1024, |entry, payload| {
      seen.push((entry.name.clone(), payload.len()));
      true
    });
    match outcome {
      NativeArchiveOutcome::Decoded { entries, .. } => assert_eq!(entries, 2),
      NativeArchiveOutcome::Failed(detail) => panic!("decodarea a esuat: {detail}"),
      NativeArchiveOutcome::Unavailable(detail) => panic!("decodorul indisponibil: {detail}"),
    }
    assert_eq!(seen.len(), 2);
    assert!(seen.iter().any(|(name, size)| name.contains("installer.exe") && *size == pe.len()));
    assert!(seen.iter().any(|(name, size)| name.contains("readme.txt") && *size == 11));
  }

  #[cfg(feature = "archive")]
  #[test]
  fn the_callback_can_stop_the_walk_early_without_reading_the_rest() {
    let archive = write_test_archive("7z", &[("a.txt", b"unu"), ("b.txt", b"doi"), ("c.txt", b"trei")]);
    let mut visited = 0u32;
    let outcome = decode_native_archive(&archive, 8 * 1024 * 1024, |_entry, _payload| {
      visited += 1;
      visited < 2
    });
    assert_eq!(visited, 2, "oprirea la al doilea element nu mai citeste al treilea");
    match outcome {
      NativeArchiveOutcome::Decoded { entries, .. } => assert_eq!(entries, 2),
      other => panic!("asteptam Decoded, am primit altceva: {}", match other {
        NativeArchiveOutcome::Failed(detail) => detail,
        NativeArchiveOutcome::Unavailable(detail) => detail,
        NativeArchiveOutcome::Decoded { .. } => unreachable!(),
      }),
    }
  }

  #[cfg(feature = "archive")]
  #[test]
  fn a_corrupt_archive_is_reported_as_failed_not_silently_empty() {
    let mut archive = write_test_archive("7z", &[("a.txt", b"continut")]);
    let length = archive.len();
    archive.truncate(length / 2);
    let outcome = decode_native_archive(&archive, 8 * 1024 * 1024, |_entry, _payload| true);
    assert!(
      matches!(outcome, NativeArchiveOutcome::Failed(_)),
      "o arhiva trunchiata trebuie sa raporteze esec, nu zero intrari"
    );
  }

  #[cfg(feature = "archive")]
  #[test]
  fn entry_payloads_are_capped_so_a_bomb_cannot_exhaust_memory() {
    let big = vec![0x42u8; 512 * 1024];
    let archive = write_test_archive("7z", &[("mare.bin", &big)]);
    let mut largest = 0usize;
    decode_native_archive(&archive, 4096, |_entry, payload| {
      largest = largest.max(payload.len());
      true
    });
    assert!(largest <= 4096, "payload-ul per intrare respecta plafonul primit ({largest} bytes)");
  }
}
