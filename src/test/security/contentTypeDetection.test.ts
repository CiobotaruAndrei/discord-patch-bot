import test from "node:test";
import assert from "node:assert/strict";

import {
  inspectMagic,
  inspectMagicFallback,
  describeMismatches,
  MISMATCH_EXTENSION,
  MISMATCH_DECLARED_MIME,
  MISMATCH_POLYGLOT,
  MISMATCH_DISGUISED_EXECUTABLE,
  MISMATCH_TRUNCATED,
  type MagicReport,
  type DetectedKind
} from "../../features/command-security/contentTypeDetection.js";
import { isRustFuzzyAvailable } from "../../native/fuzzy.js";

function peBytes(): Buffer {
  return Buffer.concat([
    Buffer.from("MZ", "latin1"),
    Buffer.from([0x90, 0x00]),
    Buffer.from("This program cannot be run in DOS mode", "latin1"),
    Buffer.alloc(512, 0x41)
  ]);
}

function zipBytes(entry: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.alloc(26, 0),
    Buffer.from(entry, "utf8"),
    Buffer.alloc(64, 0),
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    Buffer.alloc(18, 0)
  ]);
}

function oleBytes(): Buffer {
  return Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512, 0)]);
}

function pdfBytes(): Buffer {
  return Buffer.from("%PDF-1.7\ncontinut simplu\n%%EOF\n", "latin1");
}

const CORPUS: Array<{ name: string; bytes: Buffer; filename: string; declared: string }> = [
  { name: "pe-ca-jpg", bytes: peBytes(), filename: "poza.jpg", declared: "image/jpeg" },
  { name: "pe-corect", bytes: peBytes(), filename: "setup.exe", declared: "application/octet-stream" },
  { name: "elf", bytes: Buffer.concat([Buffer.from([0x7f]), Buffer.from("ELF", "latin1"), Buffer.alloc(64, 0)]), filename: "tool", declared: "" },
  { name: "macho", bytes: Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.alloc(64, 0)]), filename: "tool", declared: "" },
  { name: "wasm", bytes: Buffer.concat([Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])]), filename: "m.wasm", declared: "" },
  { name: "pdf-ca-txt", bytes: pdfBytes(), filename: "note.txt", declared: "text/plain" },
  { name: "pdf-trunchiat", bytes: Buffer.from("%PDF-1.7\nfara sfarsit", "latin1"), filename: "doc.pdf", declared: "application/pdf" },
  { name: "docx", bytes: zipBytes("word/document.xml"), filename: "raport.docx", declared: "" },
  { name: "xlsx", bytes: zipBytes("xl/workbook.xml"), filename: "raport.xlsx", declared: "" },
  { name: "pptx", bytes: zipBytes("ppt/presentation.xml"), filename: "raport.pptx", declared: "" },
  { name: "apk", bytes: zipBytes("AndroidManifest.xml"), filename: "app.apk", declared: "" },
  { name: "jar", bytes: zipBytes("META-INF/MANIFEST.MF"), filename: "tool.jar", declared: "" },
  { name: "zip-simplu", bytes: zipBytes("readme.txt"), filename: "arhiva.zip", declared: "application/zip" },
  { name: "docx-numit-zip", bytes: zipBytes("word/document.xml"), filename: "arhiva.zip", declared: "application/zip" },
  { name: "rar5", bytes: Buffer.concat([Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]), Buffer.alloc(32, 0)]), filename: "a.rar", declared: "" },
  { name: "rar4", bytes: Buffer.concat([Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]), Buffer.alloc(32, 0)]), filename: "a.rar", declared: "" },
  { name: "sevenzip", bytes: Buffer.concat([Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), Buffer.alloc(32, 0)]), filename: "a.7z", declared: "" },
  { name: "gzip", bytes: Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0]), filename: "a.gz", declared: "" },
  { name: "bzip2", bytes: Buffer.from("BZh9rest", "latin1"), filename: "a.bz2", declared: "" },
  { name: "xz", bytes: Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00, 0, 0]), filename: "a.xz", declared: "" },
  { name: "zstd", bytes: Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0, 0, 0, 0]), filename: "a.zst", declared: "" },
  { name: "cab", bytes: Buffer.concat([Buffer.from("MSCF", "latin1"), Buffer.alloc(32, 0)]), filename: "a.cab", declared: "" },
  { name: "msi", bytes: oleBytes(), filename: "setup.msi", declared: "" },
  { name: "doc-ole", bytes: oleBytes(), filename: "raport.doc", declared: "application/msword" },
  { name: "tar", bytes: Buffer.concat([Buffer.alloc(257, 0), Buffer.from("ustar", "latin1"), Buffer.alloc(256, 0)]), filename: "a.tar", declared: "" },
  { name: "shebang", bytes: Buffer.from("#!/bin/bash\necho salut\n", "latin1"), filename: "script.sh", declared: "text/plain" },
  { name: "text-simplu", bytes: Buffer.from("doar text simplu fara semnaturi", "latin1"), filename: "note.txt", declared: "text/plain" },
  { name: "text-utf8", bytes: Buffer.from("salut ăîșț", "utf8"), filename: "note.txt", declared: "text/plain" },
  { name: "utf16-bom", bytes: Buffer.from([0xff, 0xfe, 0x61, 0x00]), filename: "note.txt", declared: "" },
  { name: "jpeg", bytes: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 0x41)]), filename: "a.jpg", declared: "image/jpeg" },
  { name: "png", bytes: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 0)]), filename: "a.png", declared: "" },
  { name: "gif", bytes: Buffer.concat([Buffer.from("GIF89a", "latin1"), Buffer.alloc(32, 0)]), filename: "a.gif", declared: "" },
  { name: "webp", bytes: Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.alloc(4, 0), Buffer.from("WEBP", "latin1"), Buffer.alloc(16, 0)]), filename: "a.webp", declared: "" },
  { name: "wav", bytes: Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.alloc(4, 0), Buffer.from("WAVE", "latin1"), Buffer.alloc(16, 0)]), filename: "a.wav", declared: "" },
  { name: "mp4", bytes: Buffer.concat([Buffer.alloc(4, 0), Buffer.from("ftypisom", "latin1"), Buffer.alloc(16, 0)]), filename: "clip.mp4", declared: "" },
  { name: "avif", bytes: Buffer.concat([Buffer.alloc(4, 0), Buffer.from("ftypavif", "latin1"), Buffer.alloc(16, 0)]), filename: "a.avif", declared: "" },
  { name: "matroska", bytes: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(32, 0)]), filename: "clip.mkv", declared: "" },
  { name: "poliglot-zip-pe", bytes: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("This program cannot be run in DOS mode", "latin1"), Buffer.alloc(32, 0)]), filename: "arhiva.zip", declared: "application/zip" },
  { name: "gol", bytes: Buffer.alloc(0), filename: "gol.bin", declared: "" },
  { name: "binar-necunoscut", bytes: Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]), filename: "date.bin", declared: "" }
];

function comparable(report: MagicReport): string {
  return JSON.stringify({
    mime: report.mime,
    description: report.description,
    encoding: report.encoding,
    kind: report.kind,
    extensionMime: report.extensionMime,
    declaredMime: report.declaredMime,
    mismatchFlags: report.mismatchFlags
  });
}

test("detectorul nativ si fallback-ul TS dau acelasi raport pe tot corpusul de tipuri", () => {
  if (!isRustFuzzyAvailable()) return;
  const mismatches: string[] = [];
  for (const entry of CORPUS) {
    const native = comparable(inspectMagic(entry.bytes, entry.filename, entry.declared));
    const fallback = comparable(inspectMagicFallback(entry.bytes, entry.filename, entry.declared));
    if (native !== fallback) mismatches.push(`${entry.name}: native=${native} ts=${fallback}`);
  }
  assert.deepEqual(mismatches, [], "raportul nativ trebuie sa fie identic cu cel TS pentru fiecare tip");
});

test("un PE redenumit .jpg este raportat ca executabil deghizat, nu ca imagine", () => {
  const report = inspectMagic(peBytes(), "poza.jpg", "image/jpeg");
  assert.equal(report.kind, "executable");
  assert.equal(report.mime, "application/vnd.microsoft.portable-executable");
  assert.ok(report.mismatchFlags & MISMATCH_EXTENSION, "extensia contrazice continutul");
  assert.ok(report.mismatchFlags & MISMATCH_DECLARED_MIME, "MIME-ul declarat contrazice continutul");
  assert.ok(report.mismatchFlags & MISMATCH_DISGUISED_EXECUTABLE);
  assert.ok(describeMismatches(report).some(note => note.includes("executabil prezentat sub alt tip")));
});

test("un PDF cu extensia .txt ramane document, nu devine executabil deghizat", () => {
  const report = inspectMagic(pdfBytes(), "note.txt", "text/plain");
  assert.equal(report.mime, "application/pdf");
  assert.equal(report.kind, "document");
  assert.ok(report.mismatchFlags & MISMATCH_EXTENSION);
  assert.equal(report.mismatchFlags & MISMATCH_DISGUISED_EXECUTABLE, 0, "un PDF nu este un executabil deghizat");
});

test("containerele ZIP sunt separate pe familii: DOCX, XLSX, PPTX, APK, JAR si ZIP simplu", () => {
  assert.equal(inspectMagic(zipBytes("word/document.xml"), "a.docx", "").mime, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(inspectMagic(zipBytes("xl/workbook.xml"), "a.xlsx", "").mime, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(inspectMagic(zipBytes("ppt/presentation.xml"), "a.pptx", "").mime, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  assert.equal(inspectMagic(zipBytes("AndroidManifest.xml"), "a.apk", "").mime, "application/vnd.android.package-archive");
  assert.equal(inspectMagic(zipBytes("META-INF/MANIFEST.MF"), "a.jar", "").mime, "application/java-archive");
  assert.equal(inspectMagic(zipBytes("readme.txt"), "a.zip", "").mime, "application/zip");
});

test("un DOCX numit .zip nu produce mismatch: ambele sunt containere ZIP", () => {
  const report = inspectMagic(zipBytes("word/document.xml"), "arhiva.zip", "application/zip");
  assert.equal(report.mismatchFlags, 0);
  assert.deepEqual(describeMismatches(report), []);
});

test("un MSI este recunoscut ca acelasi container OLE ca .doc, fara mismatch fals", () => {
  assert.equal(inspectMagic(oleBytes(), "setup.msi", "").mismatchFlags, 0);
  assert.equal(inspectMagic(oleBytes(), "raport.doc", "application/msword").mismatchFlags, 0);
});

test("shebang-ul intr-un .sh declarat text/plain nu este o contradictie", () => {
  const report = inspectMagic(Buffer.from("#!/bin/bash\necho salut\n", "latin1"), "script.sh", "text/plain");
  assert.equal(report.kind, "script");
  assert.equal(report.encoding, "us-ascii");
  assert.equal(report.mismatchFlags, 0);
});

test("un buffer trunchiat sau gol este marcat, fara sa schimbe tipul detectat", () => {
  const truncated = inspectMagic(Buffer.from("%PDF-1.7\nfara sfarsit", "latin1"), "doc.pdf", "application/pdf");
  assert.equal(truncated.mime, "application/pdf");
  assert.ok(truncated.mismatchFlags & MISMATCH_TRUNCATED);

  const empty = inspectMagic(Buffer.alloc(0), "gol.bin", "");
  assert.equal(empty.kind, "other");
  assert.ok(empty.mismatchFlags & MISMATCH_TRUNCATED);
});

test("un fisier poliglot ZIP care poarta un stub PE este semnalat", () => {
  const polyglot = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from("This program cannot be run in DOS mode", "latin1"),
    Buffer.alloc(32, 0)
  ]);
  const report = inspectMagic(polyglot, "arhiva.zip", "application/zip");
  assert.ok(report.mismatchFlags & MISMATCH_POLYGLOT);
  assert.ok(describeMismatches(report).some(note => note.includes("poliglot")));
});

test("un MIME declarat generic (octet-stream) nu contrazice niciodata tipul detectat", () => {
  const report = inspectMagic(peBytes(), "setup.exe", "application/octet-stream");
  assert.equal(report.kind, "executable");
  assert.equal(report.mismatchFlags, 0);
});

test("encoding-ul este raportat pentru BOM-uri, text si continut binar", () => {
  assert.equal(inspectMagic(Buffer.from([0xef, 0xbb, 0xbf, 0x61]), "a.txt", "").encoding, "utf-8-bom");
  assert.equal(inspectMagic(Buffer.from([0xff, 0xfe, 0x61, 0x00]), "a.txt", "").encoding, "utf-16le");
  assert.equal(inspectMagic(Buffer.from([0xfe, 0xff, 0x00, 0x61]), "a.txt", "").encoding, "utf-16be");
  assert.equal(inspectMagic(Buffer.from("salut ăîș", "utf8"), "a.txt", "").encoding, "utf-8");
  assert.equal(inspectMagic(Buffer.from([0x00, 0x01, 0x02]), "a.bin", "").encoding, "binary");
});

test("corpusul acopera toate categoriile cerute: executabil, arhiva, document, script, imagine, media si text", () => {
  const kinds = new Set(CORPUS.map(entry => inspectMagicFallback(entry.bytes, entry.filename, entry.declared).kind));
  const expectedKinds: DetectedKind[] = ["executable", "archive", "document", "script", "image", "media", "text", "other"];
  for (const expected of expectedKinds) {
    assert.ok(kinds.has(expected), `corpusul contine cel putin un caz de tip ${expected}`);
  }
});
