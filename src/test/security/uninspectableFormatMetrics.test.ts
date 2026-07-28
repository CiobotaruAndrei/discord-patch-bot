import test from "node:test";
import assert from "node:assert/strict";

import {
  getUninspectableFormatTotals,
  normalizeUninspectableFormat,
  recordUninspectableFormat,
  resetUninspectableFormatTotals
} from "../../features/command-security/uninspectableFormatMetrics.js";

test("formatele sunt normalizate ca sa fie etichete Prometheus valide", () => {
  assert.equal(normalizeUninspectableFormat("CHM"), "chm");
  assert.equal(normalizeUninspectableFormat("video ISO-BMFF"), "video_iso-bmff");
  assert.equal(normalizeUninspectableFormat("  CAB  "), "cab");
});

test("un format venit corupt sau exagerat de lung nu ajunge in metrici", () => {
  assert.equal(normalizeUninspectableFormat(""), undefined);
  assert.equal(normalizeUninspectableFormat("   "), undefined);
  assert.equal(normalizeUninspectableFormat("!!!"), undefined, "fara caractere utile nu ramane nimic");
  assert.equal(normalizeUninspectableFormat("x".repeat(40)), undefined, "o eticheta prea lunga e refuzata");
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
