import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSbom,
  parseLockVersions,
  readLock,
  renderSbomTable,
  NATIVE_COMPONENTS
} from "../../scripts/native-sbom.js";

const lock = readLock(process.cwd());

test("fiecare componenta nativa declarata exista efectiv in Cargo.lock", () => {
  const { missing } = buildSbom(lock);
  assert.deepEqual(
    missing,
    [],
    "o componenta declarata dar disparuta din lock inseamna ca SBOM-ul minte despre ce se livreaza"
  );
});

test("librariile C/C++ legate efectiv sunt toate in SBOM", () => {
  const linked = NATIVE_COMPONENTS.filter(entry => entry.kind !== "rust").map(entry => entry.crate);
  for (const required of ["yara", "libarchive2-sys", "qpdf", "libseccomp"]) {
    assert.ok(linked.includes(required), `${required} este legata efectiv si trebuie sa apara in SBOM`);
  }
});

test("SBOM-ul poarta versiunea exacta, nu un interval", () => {
  const { entries } = buildSbom(lock);
  for (const entry of entries) {
    assert.match(
      entry.version,
      /^\d+\.\d+\.\d+/,
      `${entry.crate} trebuie sa aiba o versiune fixa: ${entry.version}`
    );
  }
});

test("sursa C/C++ vendorata e declarata pentru fiecare componenta nativa", () => {
  const { entries } = buildSbom(lock);
  for (const entry of entries.filter(item => item.kind !== "rust")) {
    assert.notEqual(entry.vendored, "-", `${entry.crate} trebuie sa spuna ce sursa C/C++ aduce`);
  }
});

test("parsarea lock-ului citeste perechile nume/versiune, nu doar prima", () => {
  const sample = [
    "[[package]]",
    'name = "alpha"',
    'version = "1.2.3"',
    "",
    "[[package]]",
    'name = "beta"',
    'version = "4.5.6"'
  ].join("\n");
  const versions = parseLockVersions(sample);
  assert.equal(versions.get("alpha"), "1.2.3");
  assert.equal(versions.get("beta"), "4.5.6");
  assert.equal(versions.size, 2);
});

test("tabelul redat contine antetul si cate un rand pentru fiecare componenta", () => {
  const { entries } = buildSbom(lock);
  const table = renderSbomTable(entries);
  assert.match(table, /\| Crate \| Versiune \| Tip \| Sursa C\/C\+\+ \| Rol \|/);
  assert.equal(table.split("\n").length, entries.length + 2);
  assert.match(table, /`yara`/);
});
