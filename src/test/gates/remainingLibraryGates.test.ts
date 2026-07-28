import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const srcRoot = process.cwd();

function readNative(...parts: string[]): string {
  return fs.readFileSync(path.join(srcRoot, "native", "core", ...parts), "utf8");
}

test("structura unui CHM e citita fara libmspack, iar verdictul ramane neconfirmat", () => {
  const inspection = readNative("src", "inspection.rs");
  assert.ok(inspection.includes("chm_indicators"), "listarea CHM nu are voie sa dispara din inspectie");
  const tests = readNative("tests", "chm_and_ocr_gaps.rs");
  assert.ok(
    tests.includes("un_chm_isi_arata_continutul_desi_ramane_neconfirmat"),
    "CHM e un vector cunoscut; testul care dovedeste ca ii vedem continutul trebuie pastrat"
  );
});

test("listarea CHM e plafonata, fiindca vine din continut netrusted", () => {
  const module = readNative("src", "chm_listing.rs");
  for (const limit of ["max_entries", "max_name_bytes", "max_scan_bytes"]) {
    assert.ok(module.includes(limit), `lipseste plafonul ${limit}`);
  }
});

test("gate-ul OCR isi primeste populatia, cu prag impotriva zgomotului", () => {
  const inspection = readNative("src", "inspection.rs");
  assert.ok(
    inspection.includes("IMAGE_TEXT_BLIND_SPOT_BYTES"),
    "fara prag, fiecare pictograma ar intra in numaratoare si metrica nu ar mai insemna nimic"
  );
  const tests = readNative("tests", "chm_and_ocr_gaps.rs");
  assert.ok(tests.includes("o_imagine_fara_cod_alimenteaza_gate_ul_de_ocr"));
  assert.ok(tests.includes("o_imagine_minuscula_nu_umple_metricile"), "pragul are nevoie de test propriu");
});
