import test from "node:test";
import assert from "node:assert/strict";

import {
  documentIndicators,
  inspectUntrustedContent,
  inspectUntrustedContentFallback,
  DEFAULT_INSPECTION_LIMITS,
  type InspectionReport
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
    "rar4-headere-cu-executabil",
    "rar4-criptat",
    "rar4-director-fals-executabil",
    "rar5-headere-cu-macro",
    "rar5-header-criptat",
    "rar-trunchiat",
    "sevenzip-header-codificat",
    "sevenzip-header-simplu",
    "format-fara-decodor",
    "pdf-javascript-in-flux-comprimat",
    "pdf-flux-comprimat-curat",
    "ooxml-sablon-extern",
    "ooxml-obiect-ole",
    "ooxml-relatii-interne",
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
  const fixture = buildInspectionFixtures().find(entry => entry.name === "format-fara-decodor");
  assert.ok(fixture, "fixture-ul fara decodor exista");
  const report = await inspectUntrustedContent(fixture.bytes, fixture.filename, fixture.mime, fixture.mode);
  assert.equal(report.status, "uncertain", "fara decodor local verdictul nu poate fi \"inspectat\"");
  assert.equal(report.reason, "formatul arhivei nu are un decodor pasiv local; verdictul ramane neconfirmat");
});

async function fixtureReport(name: string): Promise<InspectionReport> {
  const fixture = buildInspectionFixtures().find(entry => entry.name === name);
  assert.ok(fixture, `fixture-ul ${name} exista`);
  return inspectUntrustedContent(fixture.bytes, fixture.filename, fixture.mime, fixture.mode);
}

test("RAR: headerele expun numele intrarilor, deci un executabil intern e semnalat fara a decomprima nimic", async () => {
  const report = await fixtureReport("rar4-headere-cu-executabil");
  assert.equal(report.status, "uncertain", "continutul comprimat nu are decodor local, deci verdictul ramane neconfirmat");
  assert.ok(report.indicators.includes("fisier executabil sau script intern"));
  assert.equal(report.entriesInspected, 2, "ambele intrari sunt contorizate in buget");
  assert.match(report.reason, /RAR inspectata structural doar la nivel de header/);
});

test("RAR5: numele UTF-8 din headere produc aceiasi indicatori ca RAR4", async () => {
  const report = await fixtureReport("rar5-headere-cu-macro");
  assert.equal(report.status, "uncertain");
  assert.ok(report.indicators.includes("macro sau script Office intern"));
  assert.equal(report.entriesInspected, 2);
});

test("RAR: arhiva criptata si headerul criptat sunt distinse in motiv, fara indicatori inventati", async () => {
  const encryptedEntries = await fixtureReport("rar4-criptat");
  assert.equal(encryptedEntries.status, "uncertain");
  assert.equal(encryptedEntries.reason, "arhiva criptata RAR");

  const encryptedHeaders = await fixtureReport("rar5-header-criptat");
  assert.equal(encryptedHeaders.status, "uncertain");
  assert.match(encryptedHeaders.reason, /headerul criptat/);
  assert.deepEqual(encryptedHeaders.indicators, [], "cu headerul criptat numele nu pot fi citite, deci nu se raporteaza indicatori");
});

test("RAR: un director al carui nume se termina in .exe nu e raportat ca fisier executabil", async () => {
  const report = await fixtureReport("rar4-director-fals-executabil");
  assert.deepEqual(report.indicators, []);
});

test("RAR trunchiat este raportat ca trunchiat, nu ca arhiva fara intrari", async () => {
  const report = await fixtureReport("rar-trunchiat");
  assert.equal(report.status, "uncertain");
  assert.match(report.reason, /trunchiat/);
});

test("7z: headerul codificat/criptat si cel simplu au motive distincte, ambele neconfirmate", async () => {
  const encoded = await fixtureReport("sevenzip-header-codificat");
  assert.equal(encoded.status, "uncertain");
  assert.match(encoded.reason, /7z/);
  assert.match(encoded.reason, /headerul criptat/);

  const plain = await fixtureReport("sevenzip-header-simplu");
  assert.equal(plain.status, "uncertain");
  assert.match(plain.reason, /nu expune nume de intrari inspectabile pasiv/);
});

test("bugetul de intrari se aplica si scanarii de headere RAR (fara decompresie)", async () => {
  const fixture = buildInspectionFixtures().find(entry => entry.name === "rar4-headere-cu-executabil");
  assert.ok(fixture);
  const limited = await inspectUntrustedContent(fixture.bytes, fixture.filename, fixture.mime, fixture.mode, { maxEntries: 1 });
  assert.equal(limited.status, "uncertain");
  assert.equal(limited.reason, "arhiva depaseste limita de 1 intrari");
});

test("PDF: actiunea ascunsa intr-un flux FlateDecode e prinsa de parserul structural, nu de fereastra latin1", async () => {
  const fixture = buildInspectionFixtures().find(entry => entry.name === "pdf-javascript-in-flux-comprimat");
  assert.ok(fixture);
  assert.deepEqual(
    documentIndicators(fixture.bytes),
    [],
    "scanarea de fereastra pe bytes-ul brut NU vede JavaScript-ul: e comprimat, deci fixture-ul chiar testeaza parserul structural"
  );
  const report = await inspectUntrustedContent(fixture.bytes, fixture.filename, fixture.mime, fixture.mode);
  assert.equal(report.status, "inspected");
  assert.ok(report.indicators.includes("actiune automata sau script PDF in flux comprimat (parser structural PDF)"));
  assert.ok(report.expandedBytes > 0, "bytes-ii decomprimati din fluxurile PDF intra in bugetul raportat");
});

test("PDF: un flux comprimat cu text banal nu produce indicatori (fara fals pozitiv)", async () => {
  const report = await fixtureReport("pdf-flux-comprimat-curat");
  assert.equal(report.status, "inspected");
  assert.deepEqual(report.indicators, []);
});

test("OOXML: relatia attachedTemplate externa e semnalata explicit ca sablon incarcat din exterior", async () => {
  const report = await fixtureReport("ooxml-sablon-extern");
  assert.ok(report.indicators.includes("sablon sau cadru Office incarcat dintr-o sursa externa (relatie OOXML)"));
  assert.ok(report.indicators.includes("referinta externa in document Office"));
});

test("OOXML: tipul relatiei oleObject semnaleaza obiectul incorporat chiar daca numele intrarii nu il tradeaza", async () => {
  const report = await fixtureReport("ooxml-obiect-ole");
  assert.ok(report.indicators.includes("obiect OLE incorporat in document Office"));
});

test("OOXML: un .rels cu relatii doar interne nu mai e semnalat ca referinta externa din cauza namespace-ului http", async () => {
  const report = await fixtureReport("ooxml-relatii-interne");
  assert.deepEqual(report.indicators, [], "xmlns=\"http://schemas.openxmlformats.org/...\" nu e o tinta externa");
});
