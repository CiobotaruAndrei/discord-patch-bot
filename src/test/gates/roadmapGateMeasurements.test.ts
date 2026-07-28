import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const srcRoot = process.cwd();
const measurementsPath = path.join(srcRoot, "native", "core", "tests", "roadmap_gates.rs");

function readMeasurements(): string {
  return fs.readFileSync(measurementsPath, "utf8");
}

test("masuratorile care tin gate-urile din roadmap exista", () => {
  assert.ok(
    fs.existsSync(measurementsPath),
    "native/core/tests/roadmap_gates.rs tine dovada pentru ce e implementat si ce nu; fara ea, deciziile din roadmap redevin pareri"
  );
});

test("fiecare gate ramas deschis are o masuratoare, nu doar o mentiune in document", () => {
  const source = readMeasurements();
  for (const [gate, marker] of [
    ["PDFium", "gate_pdfium_un_qr_desenat_in_pagina_pdf_nu_e_vazut_azi"],
    ["libheif", "gate_libheif_heic_si_avif_nu_ajung_niciodata_la_scanarea_vizuala"]
  ]) {
    assert.ok(
      source.includes(marker),
      `gate-ul ${gate} nu mai are masuratoare; o librarie C/C++ nu se adauga pe baza unei presupuneri`
    );
  }
});

test("golul inchis ramane acoperit: continutul imbricat ajunge la scanarea vizuala", () => {
  const source = readMeasurements();
  assert.ok(
    source.includes("un_png_cu_qr_dintr_o_arhiva_e_citit_ca_si_cand_ar_fi_trimis_direct"),
    "un cod QR dintr-o arhiva era invizibil; testul care dovedeste contrariul nu are voie sa dispara"
  );
  const inspection = fs.readFileSync(path.join(srcRoot, "native", "core", "src", "inspection.rs"), "utf8");
  const nested = inspection.slice(inspection.indexOf("fn content_indicators"));
  assert.ok(
    nested.slice(0, nested.indexOf("\nfn ")).includes("visual_indicators(bytes)"),
    "calea pentru continut imbricat trebuie sa treaca prin scanarea vizuala, altfel codurile din arhive redevin invizibile"
  );
});
