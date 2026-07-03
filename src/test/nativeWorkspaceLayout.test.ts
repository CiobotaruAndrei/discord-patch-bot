import test from "node:test";
import assert from "node:assert/strict";

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");

const srcRoot = process.cwd();
const repoRoot = path.resolve(srcRoot, "..");
const rootCargoPath = path.join(srcRoot, "native", "Cargo.toml");
const coreCargoPath = path.join(srcRoot, "native", "core", "Cargo.toml");
const coreLibPath = path.join(srcRoot, "native", "core", "src", "lib.rs");
const wrapperLibPath = path.join(srcRoot, "native", "src", "lib.rs");
const packageJsonPath = path.join(srcRoot, "package.json");
const nativePackageJsonPath = path.join(srcRoot, "native", "package.json");
const ciWorkflowPath = path.join(repoRoot, ".github", "workflows", "ci.yml");
const releaseWorkflowPath = path.join(repoRoot, ".github", "workflows", "release.yml");

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

test("native/package.json foloseste campurile N-API curente (binaryName), nu cele deprecate name/triples (review manual P3 #4)", () => {
  const napi = (JSON.parse(read(nativePackageJsonPath)) as { napi?: Record<string, unknown> }).napi || {};
  assert.equal(napi.binaryName, "discord_patch_bot_core", "napi.binaryName seteaza numele binarului .node (acelasi nume ca inainte, fara warning de build)");
  assert.ok(!("name" in napi), "napi.name (deprecat) a fost scos");
  assert.ok(!("triples" in napi), "napi.triples (deprecat) a fost scos");
});

test("crate-ul core e pur: fara napi, cu teste unitare", () => {
  assert.ok(fs.existsSync(coreCargoPath), "native/core/Cargo.toml exista");
  const cargo = read(coreCargoPath);
  assert.match(cargo, /name = "discord_patch_bot_logic"/, "numele crate-ului pur");
  assert.ok(!cargo.includes("napi"), "core-ul nu depinde de napi (testabil fara runtime N-API)");
  assert.ok(!cargo.includes("cdylib"), "core-ul e rlib implicit, nu cdylib");
  const lib = read(coreLibPath);
  assert.match(lib, /#\[cfg\(test\)\]/, "testele unitare traiesc in core");
  assert.ok(!lib.includes("napi"), "core/src/lib.rs nu atinge napi");
});

test("wrapper-ul N-API e subtire: deleaga la core si nu mai are teste proprii", () => {
  const cargo = read(rootCargoPath);
  assert.match(cargo, /\[workspace\]/, "native/ e workspace");
  assert.match(cargo, /members = \["core"\]/, "core e membru al workspace-ului");
  assert.match(cargo, /name = "discord_patch_bot_core"/, "numele cdylib-ului ramane neschimbat (fisierul .node si napi config raman valide)");
  assert.match(cargo, /discord_patch_bot_logic = \{ path = "core" \}/, "wrapper-ul depinde de core prin path");
  const lib = read(wrapperLibPath);
  assert.match(lib, /use discord_patch_bot_logic as logic/, "wrapper-ul deleaga la core");
  assert.ok(!lib.includes("#[cfg(test)]"), "wrapper-ul nu are teste (testele pure ruleaza fara build-ul N-API)");
  assert.ok(!/fn\s+\w+_impl\b/.test(lib), "logica _impl a fost mutata in core, nu duplicata in wrapper");
});

test("check:native si CI testeaza core-ul pur si dau clippy pe tot workspace-ul", () => {
  const pkg = read(packageJsonPath);
  assert.match(pkg, /cargo clippy --manifest-path native\/Cargo\.toml --workspace --all-targets -- -D warnings/, "clippy acopera ambele crate-uri");
  assert.match(pkg, /cargo test --manifest-path native\/Cargo\.toml -p discord_patch_bot_logic --quiet/, "cargo test ruleaza pe crate-ul pur, fara build-ul N-API");
  const ci = read(ciWorkflowPath);
  assert.match(ci, /--workspace --all-targets/, "clippy pe workspace in ci.yml");
  assert.match(ci, /-p discord_patch_bot_logic/, "testele pure in ci.yml");
  const release = read(releaseWorkflowPath);
  assert.match(release, /npm run check:full/, "release.yml ruleaza check:full, care include check:native (clippy --workspace + cargo test pur), fara a duplica pasul de clippy");
});

test("crate-ul core pur e organizat pe module pe responsabilitate, iar lib.rs doar le declara si le re-exporta", () => {
  const coreSrcDir = path.join(srcRoot, "native", "core", "src");
  const modules = ["types", "text", "hashing", "deals", "updates", "autocomplete", "listing_rank", "fuzzy"];
  for (const name of modules) {
    assert.ok(fs.existsSync(path.join(coreSrcDir, `${name}.rs`)), `native/core/src/${name}.rs exista`);
  }
  const lib = read(coreLibPath);
  for (const name of modules) {
    assert.match(lib, new RegExp(`mod ${name};`), `lib.rs declara modulul ${name}`);
  }
  assert.match(lib, /pub use fuzzy::find_game_keys;/, "lib.rs re-exporta find_game_keys din modulul fuzzy");
  assert.match(lib, /pub use hashing::\{[^}]*deal_hash[^}]*\};/, "lib.rs re-exporta deal_hash din modulul hashing");
  assert.ok(!/\npub fn (levenshtein|deal_hash|find_game_keys|classify_patch_note)\(/.test(lib), "logica nu mai e definita inline in lib.rs (mutata in module), doar re-exportata");
});
