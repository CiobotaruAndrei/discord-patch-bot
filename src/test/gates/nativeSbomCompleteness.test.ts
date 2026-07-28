import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

import {
  NATIVE_COMPONENTS,
  NON_SHIPPED_NATIVE_CRATES,
  buildSbom,
  findUnclassifiedNativeCrates,
  isNativeBindingCrate,
  readLock,
  renderSbomTable
} from "../../scripts/native-sbom.js";

const srcRoot = process.cwd();
const repoRoot = path.resolve(srcRoot, "..");

test("fiecare crate cu legaturi native din Cargo.lock e clasificat, livrat sau nu", () => {
  const unclassified = findUnclassifiedNativeCrates(readLock(srcRoot));
  assert.deepEqual(
    unclassified,
    [],
    `SBOM-ul enumera doar ce declaram noi, deci o librarie C/C++ nou aparuta in lock ar fi livrata fara sa apara nicaieri; ` +
      `clasifica ${unclassified.join(", ")} in NATIVE_COMPONENTS sau in NON_SHIPPED_NATIVE_CRATES`
  );
});

test("un crate nativ nou, nedeclarat, este respins", () => {
  const lock = '[[package]]\nname = "lief-sys"\nversion = "0.16.0"\n';
  assert.deepEqual(findUnclassifiedNativeCrates(lock), ["lief-sys"]);
});

test("clasificarea acopera crate-ul, nu doar prefixul lui", () => {
  assert.ok(isNativeBindingCrate("yara-sys"));
  assert.ok(!isNativeBindingCrate("yara"));
});

test("fiecare crate scutit are un motiv scris, nu doar un nume", () => {
  for (const entry of NON_SHIPPED_NATIVE_CRATES) {
    assert.ok(
      entry.reason.length >= 20,
      `${entry.crate} e exclus din SBOM fara motiv verificabil; scutirea tacuta e exact felul in care o librarie livrata dispare din inventar`
    );
  }
});

test("un crate nu poate fi si declarat si scutit", () => {
  const declared = new Set(NATIVE_COMPONENTS.map(component => component.crate));
  for (const entry of NON_SHIPPED_NATIVE_CRATES) {
    assert.ok(
      !declared.has(entry.crate),
      `${entry.crate} apare si in NATIVE_COMPONENTS si in NON_SHIPPED_NATIVE_CRATES; una dintre ele minte`
    );
  }
});

test("tabelul SBOM din BENCHMARKS.md e identic cu iesirea generata", () => {
  const doc = fs.readFileSync(path.join(repoRoot, "BENCHMARKS.md"), "utf8").replace(/\r\n/g, "\n");
  const generated = renderSbomTable(buildSbom(readLock(srcRoot)).entries);
  assert.ok(
    doc.includes(generated),
    "tabelul publicat a ramas in urma codului cel putin o data (lipseau libmagic si msi); " +
      "regenereaza-l cu `npm run sbom:native` si inlocuieste blocul din BENCHMARKS.md"
  );
});

test("workflow-ul de release nu reutilizeaza cache pentru artefactele livrate", () => {
  const release = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "release.yml"), "utf8");
  const active = release
    .split("\n")
    .filter(line => !line.trim().startsWith("#"))
    .join("\n");
  for (const pattern of [/uses:\s*actions\/cache@/, /uses:\s*Swatinem\/rust-cache@/, /cache-from:/, /cache-to:/]) {
    assert.ok(
      !pattern.test(active),
      `release.yml foloseste ${pattern.source}; artefactul livrat trebuie construit din sursa, altfel semnam un binar a carui provenienta vine dintr-un cache mutabil`
    );
  }
});
