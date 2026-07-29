use std::env;
use std::path::PathBuf;

fn vcpkg_root() -> Option<PathBuf> {
  for key in ["VCPKG_INSTALLATION_ROOT", "VCPKG_ROOT"] {
    if let Ok(value) = env::var(key) {
      if !value.is_empty() {
        return Some(PathBuf::from(value));
      }
    }
  }
  let fallback = PathBuf::from("C:/vcpkg");
  fallback.is_dir().then_some(fallback)
}

fn main() {
  println!("cargo:rerun-if-changed=build.rs");
  println!("cargo:rerun-if-env-changed=VCPKG_INSTALLATION_ROOT");
  println!("cargo:rerun-if-env-changed=VCPKG_ROOT");

  let windows = env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows");
  let mut include_dirs: Vec<PathBuf> = Vec::new();

  if windows {
    let root = vcpkg_root().expect(
      "libmspack nu a fost gasit: seteaza VCPKG_ROOT sau instaleaza cu `vcpkg install libmspack:x64-windows`",
    );
    let installed = root.join("installed").join("x64-windows");
    println!("cargo:rustc-link-search=native={}", installed.join("lib").display());
    println!("cargo:rustc-link-lib=libmspack");
    include_dirs.push(installed.join("include"));
  } else {
    println!("cargo:rustc-link-lib=mspack");
  }

  let mut builder = bindgen::Builder::default()
    .header_contents("wrapper.h", "#include <mspack.h>")
    .allowlist_function("mspack_create_cab_decompressor")
    .allowlist_function("mspack_destroy_cab_decompressor")
    .allowlist_function("mspack_create_chm_decompressor")
    .allowlist_function("mspack_destroy_chm_decompressor")
    .allowlist_type("mspack_system")
    .allowlist_type("mspack_file")
    .allowlist_type("mscab_decompressor")
    .allowlist_type("mscabd_cabinet")
    .allowlist_type("mscabd_file")
    .allowlist_type("mschm_decompressor")
    .allowlist_type("mschmd_header")
    .allowlist_type("mschmd_file")
    .allowlist_var("MSPACK_SYS_OPEN_.*")
    .allowlist_var("MSPACK_SYS_SEEK_.*")
    .allowlist_var("MSPACK_ERR_.*")
    .layout_tests(false)
    .derive_default(true);

  for dir in &include_dirs {
    builder = builder.clang_arg(format!("-I{}", dir.display()));
  }

  let mut shim = cc::Build::new();
  shim.file("shim.c");
  for dir in &include_dirs {
    shim.include(dir);
  }
  shim.compile("mspack_shim");
  println!("cargo:rerun-if-changed=shim.c");

  let bindings = builder.generate().expect("bindgen nu a putut citi mspack.h");
  let out = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR lipseste"));
  bindings.write_to_file(out.join("bindings.rs")).expect("nu am putut scrie bindings.rs");
}
