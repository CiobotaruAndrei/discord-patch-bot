import test from "node:test";
import assert from "node:assert/strict";

import {
  inspectUntrustedContent,
  inspectUntrustedContentFallback,
  DEFAULT_INSPECTION_LIMITS
} from "../../features/command-security/passiveArchiveInspection.js";
import { buildInspectionFixtures, buildHeavyFixture, inspectionParityMismatches } from "../../scripts/inspectionBenchmark.js";
import { isRustFuzzyAvailable } from "../../native/fuzzy.js";

test("motorul Rust si fallback-ul TS dau acelasi raport pe tot corpusul de fixtures (paritate batch)", async () => {
  const mismatches = await inspectionParityMismatches();
  assert.deepEqual(mismatches, [], "raportul nativ trebuie sa fie identic cu cel TS pentru fiecare fixture");
});

test("corpusul de paritate acopera ZIP/TAR/GZIP/CFB/PDF/RAR/7z plus cazurile de esec structural", () => {
  const names = buildInspectionFixtures().map(fixture => fixture.name);
  for (const expected of [
    "zip-stored-curat",
    "zip-deflate-executabile",
    "zip-nested-zip",
    "zip-criptat",
    "zip-trunchiat",
    "zip-bomba-raport",
    "tar-office",
    "gzip-tar",
    "gzip-trunchiat",
    "rar-fara-decodor",
    "sevenzip-fara-decodor",
    "document-pdf-javascript",
    "document-pdf-ofuscat",
    "document-ole-macro",
    "document-curat",
    "auto-docx-ca-zip"
  ]) {
    assert.ok(names.includes(expected), `corpusul include fixture-ul ${expected}`);
  }
});

test("inspectUntrustedContent este asincron: nu blocheaza apelantul si intoarce un Promise", async () => {
  const heavy = buildHeavyFixture(8);
  const pending = inspectUntrustedContent(heavy.bytes, heavy.filename, heavy.mime, heavy.mode);
  assert.equal(typeof pending.then, "function", "API-ul este asincron (AsyncTask), nu un apel sincron");
  const report = await pending;
  assert.equal(report.status, "inspected");
  assert.ok(report.entriesInspected > 0, "raportul contabilizeaza intrarile inspectate");
  assert.ok(report.expandedBytes > 0, "raportul contabilizeaza bytes decomprimati");
});

test("inspectiile concurente nu se contamineaza intre ele (buget per apel, nu global)", async () => {
  const fixtures = buildInspectionFixtures();
  const reports = await Promise.all(fixtures.map(fixture => inspectUntrustedContent(fixture.bytes, fixture.filename, fixture.mime, fixture.mode)));
  const sequential = fixtures.map(fixture => inspectUntrustedContentFallback(fixture.bytes, fixture.filename, fixture.mime, fixture.mode));
  reports.forEach((report, index) => {
    assert.equal(report.status, sequential[index].status, `${fixtures[index].name}: status identic sub concurenta`);
    assert.equal(report.entriesInspected, sequential[index].entriesInspected, `${fixtures[index].name}: bugetul de intrari nu e partajat intre task-uri`);
  });
});

test("limitele transmise sunt respectate identic de Rust si de fallback-ul TS", async () => {
  const heavy = buildHeavyFixture(12);
  const limits = { maxEntries: 3 };
  const tsReport = inspectUntrustedContentFallback(heavy.bytes, heavy.filename, heavy.mime, heavy.mode, limits);
  assert.equal(tsReport.status, "uncertain", "peste bugetul de intrari verdictul ramane neconfirmat");
  assert.equal(tsReport.reason, "arhiva depaseste limita de 3 intrari");
  if (!isRustFuzzyAvailable()) return;
  const nativeReport = await inspectUntrustedContent(heavy.bytes, heavy.filename, heavy.mime, heavy.mode, limits);
  assert.equal(nativeReport.status, tsReport.status);
  assert.equal(nativeReport.reason, tsReport.reason);
  assert.equal(nativeReport.entriesInspected, tsReport.entriesInspected);
});

test("limitele implicite sunt sursa unica: fara limite explicite raportul e identic cu cel cu limitele implicite pasate explicit", async () => {
  const fixture = buildInspectionFixtures().find(entry => entry.name === "zip-deflate-executabile");
  assert.ok(fixture, "fixture-ul de executabile exista");
  const implicit = await inspectUntrustedContent(fixture.bytes, fixture.filename, fixture.mime, fixture.mode);
  const explicit = await inspectUntrustedContent(fixture.bytes, fixture.filename, fixture.mime, fixture.mode, DEFAULT_INSPECTION_LIMITS);
  assert.deepEqual([...explicit.indicators].sort(), [...implicit.indicators].sort());
  assert.equal(explicit.status, implicit.status);
  assert.equal(explicit.entriesInspected, implicit.entriesInspected);
});

test("modul de inspectie ramane decis de TypeScript: acelasi .docx da rezultate diferite ca arhiva vs ca document", async () => {
  const fixture = buildInspectionFixtures().find(entry => entry.name === "auto-docx-ca-zip");
  assert.ok(fixture, "fixture-ul docx exista");
  const asArchive = await inspectUntrustedContent(fixture.bytes, fixture.filename, fixture.mime, "archive");
  const asDocument = await inspectUntrustedContent(fixture.bytes, fixture.filename, fixture.mime, "document");
  assert.ok(asArchive.indicators.includes("macro sau script Office intern"), "pe ruta de arhiva intrarile interne sunt clasificate");
  assert.ok(!asDocument.indicators.includes("macro sau script Office intern"), "pe ruta de document nu se traverseaza intrarile ZIP");
  assert.notEqual(asArchive.reason, asDocument.reason, "motivul reflecta ruta aleasa de TypeScript, nu o autodetectie in Rust");
});

test("continutul care nu are decodor pasiv local ramane neconfirmat, nu curat", async () => {
  for (const name of ["rar-fara-decodor", "sevenzip-fara-decodor"]) {
    const fixture = buildInspectionFixtures().find(entry => entry.name === name);
    assert.ok(fixture, `fixture-ul ${name} exista`);
    const report = await inspectUntrustedContent(fixture.bytes, fixture.filename, fixture.mime, fixture.mode);
    assert.equal(report.status, "uncertain", `${name}: fara decodor local verdictul nu poate fi "inspectat"`);
    assert.equal(report.reason, "formatul arhivei nu are un decodor pasiv local; verdictul ramane neconfirmat");
  }
});
