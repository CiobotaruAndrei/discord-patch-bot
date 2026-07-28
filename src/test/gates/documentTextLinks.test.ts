import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const srcRoot = process.cwd();

function readNative(relative: string): string {
  return fs.readFileSync(path.join(srcRoot, "native", "core", relative), "utf8");
}

test("textul vizibil al documentelor ajunge la analiza de identitate a gazdei", () => {
  const inspection = readNative(path.join("src", "inspection.rs"));
  assert.ok(
    inspection.includes("pdf_text_link_indicators"),
    "un PDF care scrie adresa de phishing in text era raportat curat; calea nu are voie sa dispara"
  );
  assert.ok(
    inspection.includes("host_identity_indicators"),
    "gazdele din documente trebuie sa treaca prin aceeasi analiza ca linkurile din mesaje, nu pe o cale paralela"
  );
});

test("extragerea de text acopera si sirurile hexazecimale, nu doar cele literale", () => {
  const tests = readNative(path.join("tests", "pdf_text_links.rs"));
  assert.ok(
    tests.includes("adresele_scrise_hexazecimal_sunt_tratate_la_fel"),
    "un atacator care vrea sa ocoleasca un scaner naiv scrie adresa hexazecimal; cazul are nevoie de test propriu"
  );
  assert.ok(
    tests.includes("aceeasi_gazda_repetata_nu_produce_indicatori_duplicati"),
    "un document poate repeta aceeasi adresa de zeci de ori; raportul nu are voie sa se umple de repetari"
  );
});

test("extragerea de text ramane plafonata", () => {
  const module = readNative(path.join("src", "document_text.rs"));
  assert.ok(module.includes("max_text_bytes"), "textul vine din continut netrusted, deci are nevoie de plafon");
  assert.ok(module.includes("max_hosts"), "numarul de gazde raportate are nevoie de plafon");
});
