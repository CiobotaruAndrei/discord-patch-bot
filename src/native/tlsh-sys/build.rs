use std::path::PathBuf;

fn main() {
  let vendor = PathBuf::from("vendor");
  let include = vendor.join("include");
  let sources = vendor.join("src");

  let mut build = cc::Build::new();
  build.cpp(true).include(&include).warnings(false);
  build.define("topval", "discord_patch_bot_tlsh_topval");

  if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
    let big_endian = std::env::var("CARGO_CFG_TARGET_ENDIAN").as_deref() == Ok("big");
    build.define("__ORDER_LITTLE_ENDIAN__", "1234");
    build.define("__ORDER_BIG_ENDIAN__", "4321");
    build.define("__BYTE_ORDER__", if big_endian { "4321" } else { "1234" });
  }
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
