import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, gzipSync } from "node:zlib";
import { analyzeThreatBytes } from "../../features/command-security/threatPipeline.js";
import { detectThreatArchiveFormat, inspectThreatBytes } from "../../features/command-security/threatArchiveInspector.js";
import { sha256Bytes } from "../../features/command-security/threatInspection.js";

function writeU16(view: DataView, offset: number, value: number): void { view.setUint16(offset, value, true); }
function writeU32(view: DataView, offset: number, value: number): void { view.setUint32(offset, value, true); }

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function zip(entries: ReadonlyArray<{ name: string; body: Uint8Array }>): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const body = deflateRawSync(entry.body);
    const local = new Uint8Array(30 + name.length + body.length);
    const localView = new DataView(local.buffer);
    writeU32(localView, 0, 0x04034b50); writeU16(localView, 4, 20); writeU16(localView, 8, 8);
    writeU32(localView, 18, body.length); writeU32(localView, 22, entry.body.length); writeU16(localView, 26, name.length);
    local.set(name, 30); local.set(body, 30 + name.length);
    locals.push(local);
    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    writeU32(centralView, 0, 0x02014b50); writeU16(centralView, 4, 20); writeU16(centralView, 6, 20); writeU16(centralView, 10, 8);
    writeU32(centralView, 20, body.length); writeU32(centralView, 24, entry.body.length); writeU16(centralView, 28, name.length); writeU32(centralView, 42, offset);
    central.set(name, 46); centrals.push(central); offset += local.length;
  }
  const central = concat(centrals);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeU32(endView, 0, 0x06054b50); writeU16(endView, 8, entries.length); writeU16(endView, 10, entries.length); writeU32(endView, 12, central.length); writeU32(endView, 16, offset);
  return concat([...locals, central, end]);
}

function tar(name: string, body: Uint8Array): Uint8Array {
  const header = new Uint8Array(512);
  header.set(new TextEncoder().encode(name), 0);
  const size = body.length.toString(8).padStart(11, "0");
  header.set(new TextEncoder().encode(`${size}\0`), 124);
  header.set(new TextEncoder().encode("ustar\0"), 257);
  return concat([header, body, new Uint8Array((512 - (body.length % 512)) % 512), new Uint8Array(1024)]);
}

test("inspectThreatBytes inspecteaza ZIP/TAR/GZIP recursiv si detecteaza pachete Office active", () => {
  const office = zip([
    { name: "[Content_Types].xml", body: new TextEncoder().encode("<Types/>") },
    { name: "word/vbaProject.bin", body: new TextEncoder().encode("macro") },
    { name: "word/document.xml", body: new TextEncoder().encode("TargetMode=\"External\" https://example.test") }
  ]);
  const zipResult = inspectThreatBytes(office, "payload.docm");
  assert.equal(detectThreatArchiveFormat(office, "payload.docm"), "zip");
  assert.equal(zipResult.state, "suspicious");
  assert.equal(zipResult.complete, true);
  assert.ok(zipResult.findings.some(finding => finding.kind === "macro"));
  const tarResult = inspectThreatBytes(tar("clean.txt", new TextEncoder().encode("curat")), "payload.tar");
  assert.equal(tarResult.state, "clean");
  assert.equal(inspectThreatBytes(gzipSync(new TextEncoder().encode("curat")), "payload.gz").state, "clean");
});

test("inspectThreatBytes detecteaza indicatorii pasivi PDF si pastreaza RAR/7Z uncertain", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7 /OpenAction /JavaScript /EmbeddedFile /XFA");
  const pdfResult = inspectThreatBytes(pdf, "payload.pdf");
  assert.equal(pdfResult.state, "suspicious");
  assert.equal(pdfResult.complete, true);
  assert.equal(inspectThreatBytes(new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]), "payload.rar").state, "uncertain");
  assert.equal(inspectThreatBytes(new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), "payload.7z").complete, false);
});

test("analyzeThreatBytes accepta doar verdict extern legat de hash-ul obiectului", async () => {
  const resource = { kind: "attachment" as const, url: "https://example.test/file.rar", name: "file.rar" };
  const bytes = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
  const complete = await analyzeThreatBytes({
    bytes,
    resource,
    externalScanner: async input => ({ confirmed: true, complete: true, hash: input.hash, scanId: "scan-1" })
  });
  assert.equal(complete.state, "confirmed");
  const mismatched = await analyzeThreatBytes({
    bytes,
    resource,
    externalScanner: async () => ({ confirmed: true, complete: true, hash: sha256Bytes(new Uint8Array([1])), scanId: "scan-2" })
  });
  assert.equal(mismatched.state, "uncertain");
  assert.equal(mismatched.complete, false);
});

test("limitele scanarii transforma arhivele bomb in uncertain si nu sterg continutul", () => {
  const result = inspectThreatBytes(zip([{ name: "large.txt", body: new TextEncoder().encode("x".repeat(100)) }]), "payload.zip", { maxDecompressedBytes: 10 });
  assert.equal(result.state, "uncertain");
  assert.equal(result.complete, false);
  assert.ok(result.findings.some(finding => finding.kind === "archive-limit"));
});
