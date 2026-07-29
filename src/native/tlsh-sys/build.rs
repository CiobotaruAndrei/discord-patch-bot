use std::path::PathBuf;

fn main() {
  let vendor = PathBuf::from("vendor");
  let include = vendor.join("include");
  let sources = vendor.join("src");

  let mut build = cc::Build::new();
  build.cpp(true).include(&include).warnings(false);
  if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
    build.define("WINDOWS", None);
  }
  for name in ["tlsh.cpp", "tlsh_impl.cpp", "tlsh_util.cpp"] {
    build.file(sources.join(name));
  }
  build.file("shim.cpp");
  build.compile("tlsh");

  println!("cargo:rerun-if-changed=shim.cpp");
  println!("cargo:rerun-if-changed=build.rs");
  println!("cargo:rerun-if-changed={}", include.display());
  println!("cargo:rerun-if-changed={}", sources.display());
}
