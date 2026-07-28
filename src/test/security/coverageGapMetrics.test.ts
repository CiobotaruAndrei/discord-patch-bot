import test from "node:test";
import assert from "node:assert/strict";

import {
  getAnalysisBlindSpotTotals,
  getUninspectableFormatTotals,
  normalizeCoverageGapLabel,
  recordAnalysisBlindSpot,
  recordUninspectableFormat,
  resetAnalysisBlindSpotTotals,
  resetUninspectableFormatTotals
} from "../../features/command-security/coverageGapMetrics.js";

test("formatele sunt normalizate ca sa fie etichete Prometheus valide", () => {
  assert.equal(normalizeCoverageGapLabel("CHM"), "chm");
  assert.equal(normalizeCoverageGapLabel("video ISO-BMFF"), "video_iso-bmff");
  assert.equal(normalizeCoverageGapLabel("  CAB  "), "cab");
});

test("un format venit corupt sau exagerat de lung nu ajunge in metrici", () => {
  assert.equal(normalizeCoverageGapLabel(""), undefined);
  assert.equal(normalizeCoverageGapLabel("   "), undefined);
  assert.equal(normalizeCoverageGapLabel("!!!"), undefined, "fara caractere utile nu ramane nimic");
  assert.equal(normalizeCoverageGapLabel("x".repeat(40)), undefined, "o eticheta prea lunga e refuzata");
});

test("numaratoarea se aduna pe format", () => {
  resetUninspectableFormatTotals();
  recordUninspectableFormat("CHM");
  recordUninspectableFormat("CHM");
  recordUninspectableFormat("HEIC");
  assert.deepEqual(getUninspectableFormatTotals(), { chm: 2, heic: 1 });
});

test("numarul de etichete distincte e plafonat, ca un expeditor sa nu poata umfla metricile", () => {
  resetUninspectableFormatTotals();
  for (let index = 0; index < 200; index += 1) {
    recordUninspectableFormat(`format${index}`);
  }
  const totals = getUninspectableFormatTotals();
  assert.ok(Object.keys(totals).length <= 64, `serii distincte: ${Object.keys(totals).length}`);

  const inainte = Object.keys(totals).length;
  recordUninspectableFormat("format0");
  assert.equal(Object.keys(getUninspectableFormatTotals()).length, inainte, "un format deja cunoscut se numara si dupa plafon");
  assert.ok((getUninspectableFormatTotals().format0 ?? 0) >= 2);
});

test("punctele oarbe de analiza se numara separat de formatele neinspectabile", () => {
  resetUninspectableFormatTotals();
  resetAnalysisBlindSpotTotals();
  recordUninspectableFormat("CHM");
  recordAnalysisBlindSpot("cod fara importuri rezolvabile");
  recordAnalysisBlindSpot("cod fara importuri rezolvabile");

  assert.deepEqual(getUninspectableFormatTotals(), { chm: 1 }, "cele doua contoare nu se amesteca");
  assert.deepEqual(getAnalysisBlindSpotTotals(), { cod_fara_importuri_rezolvabile: 2 });
});

test("punctele oarbe folosesc aceeasi normalizare si acelasi plafon", () => {
  resetAnalysisBlindSpotTotals();
  assert.equal(normalizeCoverageGapLabel("cod fara importuri rezolvabile"), "cod_fara_importuri_rezolvabile");
  for (let index = 0; index < 200; index += 1) {
    recordAnalysisBlindSpot(`punct${index}`);
  }
  assert.ok(Object.keys(getAnalysisBlindSpotTotals()).length <= 64);
});
