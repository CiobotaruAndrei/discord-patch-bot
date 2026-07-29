import test from "node:test";
import assert from "node:assert/strict";
import { readInspectionSources } from "./nativeInspectionSources.js";

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
    
    ["libheif", "gate_libheif_heic_si_avif_nu_pot_fi_decodate_dar_nu_mai_trec_tacut"]
  ]) {
    assert.ok(
      source.includes(marker),
      `gate-ul ${gate} nu mai are masuratoare; o librarie C/C++ nu se adauga pe baza unei presupuneri`
    );
  }
});

test("golurile inchise raman acoperite: continut imbricat si imagini din PDF", () => {
  const source = readMeasurements();
  assert.ok(
    source.includes("un_png_cu_qr_dintr_o_arhiva_e_citit_ca_si_cand_ar_fi_trimis_direct"),
    "un cod QR dintr-o arhiva era invizibil; testul care dovedeste contrariul nu are voie sa dispara"
  );
  assert.ok(
    source.includes("un_qr_incorporat_ca_imagine_in_pdf_e_citit_fara_pdfium"),
    "un cod incorporat ca imagine in PDF era invizibil; reconstructia bitmap-ului l-a facut vizibil fara PDFium"
  );
  const inspection = readInspectionSources();
  const nested = inspection.slice(inspection.indexOf("fn content_indicators"));
  assert.ok(
    nested.slice(0, nested.indexOf("\nfn ")).includes("visual_indicators(bytes)"),
    "calea pentru continut imbricat trebuie sa treaca prin scanarea vizuala, altfel codurile din arhive redevin invizibile"
  );
});

test("codurile desenate vectorial in PDF raman acoperite de un test propriu", () => {
  const vectorial = fs.readFileSync(path.join(srcRoot, "native", "core", "tests", "pdf_vector_codes.rs"), "utf8");
  assert.ok(
    vectorial.includes("un_qr_desenat_vectorial_in_pagina_pdf_e_citit_fara_pdfium"),
    "un cod desenat ca dreptunghiuri umplute era invizibil; rasterizarea marginita l-a facut vizibil fara PDFium"
  );
  assert.ok(
    vectorial.includes("rasterizarea_respecta_plafonul_de_pixeli"),
    "rasterizarea aloca memorie pe baza unui continut netrusted, deci plafonul nu are voie sa ramana neverificat"
  );
});
