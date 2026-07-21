import { pathToFileURL as __pathToFileURL } from "node:url";
"use strict";

import { randomBytes } from "node:crypto";
import { deflateRawSync, gzipSync } from "node:zlib";
import {
  inspectUntrustedContent,
  inspectUntrustedContentFallback,
  type InspectionMode,
  type InspectionReport
} from "../features/command-security/passiveArchiveInspection.js";
import { isRustFuzzyAvailable } from "../native/fuzzy.js";
import { strictEnvInt } from "./benchmarkEnv.js";

export interface InspectionFixture {
  name: string;
  bytes: Buffer;
  filename: string;
  mime: string;
  mode: InspectionMode;
}

interface ZipEntrySpec {
  name: string;
  data: Buffer;
  deflate?: boolean;
  encrypted?: boolean;
  declaredSize?: number;
}

function zipArchive(entries: ZipEntrySpec[]): Buffer {
  return Buffer.concat(entries.map(entry => {
    const encodedName = Buffer.from(entry.name, "utf8");
    const payload = entry.deflate ? deflateRawSync(entry.data) : entry.data;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(entry.encrypted ? 0x0001 : 0, 6);
    header.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    header.writeUInt32LE(payload.length, 18);
    header.writeUInt32LE(entry.declaredSize ?? entry.data.length, 22);
    header.writeUInt16LE(encodedName.length, 26);
    return Buffer.concat([header, encodedName, payload]);
  }));
}

function tarArchive(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512, 0);
    header.write(entry.name, 0, "utf8");
    header.write(entry.data.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
    header.write("ustar\0", 257, "ascii");
    blocks.push(header);
    const padded = Buffer.alloc(Math.ceil(entry.data.length / 512) * 512, 0);
    entry.data.copy(padded);
    blocks.push(padded);
  }
  blocks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(blocks);
}

function compoundFile(entries: Array<{ name: string; type: number }>): Buffer {
  const sectorSize = 512;
  const buffer = Buffer.alloc(512 + sectorSize * 2, 0);
  buffer.writeUInt32BE(0xd0cf11e0, 0);
  buffer.writeUInt32BE(0xa1b11ae1, 4);
  buffer.writeUInt16LE(9, 30);
  buffer.writeUInt16LE(6, 32);
  buffer.writeUInt32LE(1, 44);
  buffer.writeUInt32LE(1, 48);
  buffer.writeUInt32LE(0, 76);
  for (let i = 1; i < 109; i++) buffer.writeUInt32LE(0xffffffff, 76 + i * 4);
  const fatBase = 512;
  for (let i = 0; i < 128; i++) buffer.writeUInt32LE(0xffffffff, fatBase + i * 4);
  buffer.writeUInt32LE(0xfffffffd, fatBase);
  buffer.writeUInt32LE(0xfffffffe, fatBase + 4);
  const dirBase = 1024;
  entries.slice(0, 4).forEach((entry, index) => {
    const entryOffset = dirBase + index * 128;
    const nameBuffer = Buffer.from(entry.name, "utf16le");
    nameBuffer.copy(buffer, entryOffset);
    buffer.writeUInt16LE(nameBuffer.length + 2, entryOffset + 64);
    buffer.writeUInt8(entry.type, entryOffset + 66);
  });
  return buffer;
}

const PE_STUB = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(2048, 0x41)]);
const ELF_STUB = Buffer.concat([Buffer.from([0x7f]), Buffer.from("ELF", "ascii"), Buffer.alloc(2048, 0x42)]);
const OOXML_RELS = Buffer.from('<?xml version="1.0"?><Relationships><Relationship TargetMode="External" Target="http://evil.test/x"/></Relationships>', "utf8");
const LONG_TEXT = Buffer.from("continut de document simplu fara actiuni. ".repeat(4096), "utf8");

export function buildInspectionFixtures(): InspectionFixture[] {
  const innerZip = zipArchive([{ name: "payload/tool.exe", data: PE_STUB, deflate: true }]);
  const officeTar = tarArchive([
    { name: "word/vbaProject.bin", data: Buffer.from("Attribute VB_Name", "utf8") },
    { name: "word/_rels/document.xml.rels", data: OOXML_RELS },
    { name: "docProps/app.xml", data: LONG_TEXT }
  ]);
  return [
    {
      name: "zip-stored-curat",
      bytes: zipArchive([{ name: "readme.txt", data: LONG_TEXT }, { name: "notes.txt", data: LONG_TEXT }]),
      filename: "arhiva.zip",
      mime: "application/zip",
      mode: "archive"
    },
    {
      name: "zip-deflate-executabile",
      bytes: zipArchive([
        { name: "setup/installer.exe", data: PE_STUB, deflate: true },
        { name: "setup/loader.so", data: ELF_STUB, deflate: true },
        { name: "setup/run.ps1", data: Buffer.from("Invoke-WebRequest", "utf8"), deflate: true }
      ]),
      filename: "setup.zip",
      mime: "application/zip",
      mode: "archive"
    },
    {
      name: "zip-nested-zip",
      bytes: zipArchive([{ name: "bundle/inner.zip", data: innerZip }, { name: "bundle/readme.txt", data: LONG_TEXT }]),
      filename: "bundle.zip",
      mime: "application/zip",
      mode: "archive"
    },
    {
      name: "zip-criptat",
      bytes: zipArchive([{ name: "secret.bin", data: Buffer.alloc(512, 7), encrypted: true }]),
      filename: "secret.zip",
      mime: "application/zip",
      mode: "archive"
    },
    {
      name: "zip-trunchiat",
      bytes: zipArchive([{ name: "big.bin", data: Buffer.alloc(1024, 3) }]).subarray(0, 200),
      filename: "trunchiat.zip",
      mime: "application/zip",
      mode: "archive"
    },
    {
      name: "zip-bomba-raport",
      bytes: zipArchive([{ name: "bomb.bin", data: Buffer.alloc(4096, 0), deflate: true, declaredSize: 4096 * 1024 }]),
      filename: "bomb.zip",
      mime: "application/zip",
      mode: "archive"
    },
    {
      name: "tar-office",
      bytes: officeTar,
      filename: "office.tar",
      mime: "application/x-tar",
      mode: "archive"
    },
    {
      name: "gzip-tar",
      bytes: gzipSync(officeTar),
      filename: "office.tgz",
      mime: "application/gzip",
      mode: "archive"
    },
    {
      name: "gzip-trunchiat",
      bytes: gzipSync(LONG_TEXT).subarray(0, 24),
      filename: "text.gz",
      mime: "application/gzip",
      mode: "archive"
    },
    {
      name: "rar-fara-decodor",
      bytes: Buffer.concat([Buffer.from("Rar!", "latin1"), Buffer.from([0x1a, 0x07, 0x01, 0x00]), Buffer.alloc(4096, 9)]),
      filename: "arhiva.rar",
      mime: "application/x-rar-compressed",
      mode: "archive"
    },
    {
      name: "sevenzip-fara-decodor",
      bytes: Buffer.concat([Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), Buffer.alloc(4096, 9)]),
      filename: "arhiva.7z",
      mime: "application/x-7z-compressed",
      mode: "archive"
    },
    {
      name: "document-pdf-javascript",
      bytes: Buffer.concat([Buffer.from("%PDF-1.7 << /OpenAction << /JavaScript (app.alert) >> /Launch (calc.exe) >>", "utf8"), LONG_TEXT]),
      filename: "raport.pdf",
      mime: "application/pdf",
      mode: "document"
    },
    {
      name: "document-pdf-ofuscat",
      bytes: Buffer.concat([Buffer.from("%PDF-1.7 << /J#61vaScript (x) /OpenAct#69on << >> >>", "utf8"), LONG_TEXT]),
      filename: "ofuscat.pdf",
      mime: "application/pdf",
      mode: "document"
    },
    {
      name: "document-ole-macro",
      bytes: compoundFile([{ name: "Root Entry", type: 5 }, { name: "Macros", type: 1 }, { name: "WordDocument", type: 2 }]),
      filename: "raport.doc",
      mime: "application/msword",
      mode: "document"
    },
    {
      name: "document-curat",
      bytes: LONG_TEXT,
      filename: "note.txt",
      mime: "text/plain",
      mode: "document"
    },
    {
      name: "auto-docx-ca-zip",
      bytes: zipArchive([
        { name: "[Content_Types].xml", data: Buffer.from("<Types/>", "utf8") },
        { name: "word/vbaProject.bin", data: Buffer.from("Attribute VB_Name", "utf8"), deflate: true },
        { name: "word/document.xml", data: LONG_TEXT, deflate: true }
      ]),
      filename: "document.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      mode: "auto"
    }
  ];
}

function comparableReport(report: InspectionReport): string {
  return JSON.stringify({
    status: report.status,
    indicators: [...report.indicators].sort(),
    reason: report.reason,
    entriesInspected: report.entriesInspected,
    expandedBytes: report.expandedBytes
  });
}

export interface InspectionParityMismatch {
  fixture: string;
  native: string;
  ts: string;
}

export async function inspectionParityMismatches(
  fixtures: InspectionFixture[] = buildInspectionFixtures()
): Promise<InspectionParityMismatch[]> {
  if (!isRustFuzzyAvailable()) return [];
  const mismatches: InspectionParityMismatch[] = [];
  for (const fixture of fixtures) {
    const nativeReport = await inspectUntrustedContent(fixture.bytes, fixture.filename, fixture.mime, fixture.mode);
    const tsReport = inspectUntrustedContentFallback(fixture.bytes, fixture.filename, fixture.mime, fixture.mode);
    const nativeText = comparableReport(nativeReport);
    const tsText = comparableReport(tsReport);
    if (nativeText !== tsText) mismatches.push({ fixture: fixture.name, native: nativeText, ts: tsText });
  }
  return mismatches;
}

export function buildHeavyFixture(entries = strictEnvInt("INSPECTION_BENCH_ENTRIES", 24)): InspectionFixture {
  const noise = randomBytes(60_000);
  const chunk = Buffer.concat([noise, Buffer.from("/JavaScript /Launch DDEAUTO ".repeat(120), "utf8")]);
  const specs: ZipEntrySpec[] = [];
  for (let i = 0; i < entries; i++) specs.push({ name: `docs/file${i}.bin`, data: chunk, deflate: true });
  return {
    name: "zip-greu-incompresibil",
    bytes: zipArchive(specs),
    filename: "heavy.zip",
    mime: "application/zip",
    mode: "archive"
  };
}

export interface InspectionTiming {
  totalMs: number;
  mainThreadBlockMs: number;
  callsPerSecond: number;
}

export interface InspectionBenchmarkResult {
  iterations: number;
  payloadBytes: number;
  rustAvailable: boolean;
  ts: InspectionTiming;
  native: InspectionTiming | null;
  latencySpeedup: number | null;
  blockingReduction: number | null;
  concurrentSpeedup: number | null;
  parityMismatches: InspectionParityMismatch[];
}

const CONCURRENT_ATTACHMENTS = 8;

export async function runInspectionBenchmark(
  iterations = strictEnvInt("INSPECTION_BENCH_ITER", 20)
): Promise<InspectionBenchmarkResult> {
  const heavy = buildHeavyFixture();
  const rustAvailable = isRustFuzzyAvailable();

  let tsBlockMs = 0;
  for (let i = 0; i < iterations; i++) {
    const started = process.hrtime.bigint();
    inspectUntrustedContentFallback(heavy.bytes, heavy.filename, heavy.mime, heavy.mode);
    tsBlockMs += Number(process.hrtime.bigint() - started) / 1e6;
    await new Promise<void>(resolve => setImmediate(resolve));
  }

  let native: InspectionTiming | null = null;
  let concurrentSpeedup: number | null = null;
  if (rustAvailable) {
    let nativeBlockMs = 0;
    let nativeTotalMs = 0;
    for (let i = 0; i < iterations; i++) {
      const started = process.hrtime.bigint();
      const pending = inspectUntrustedContent(heavy.bytes, heavy.filename, heavy.mime, heavy.mode);
      nativeBlockMs += Number(process.hrtime.bigint() - started) / 1e6;
      await pending;
      nativeTotalMs += Number(process.hrtime.bigint() - started) / 1e6;
    }
    native = {
      totalMs: nativeTotalMs,
      mainThreadBlockMs: nativeBlockMs,
      callsPerSecond: iterations / (nativeTotalMs / 1000)
    };

    const concurrentStart = process.hrtime.bigint();
    await Promise.all(Array.from({ length: CONCURRENT_ATTACHMENTS }, () => inspectUntrustedContent(heavy.bytes, heavy.filename, heavy.mime, heavy.mode)));
    const concurrentMs = Number(process.hrtime.bigint() - concurrentStart) / 1e6;
    const sequentialStart = process.hrtime.bigint();
    for (let i = 0; i < CONCURRENT_ATTACHMENTS; i++) inspectUntrustedContentFallback(heavy.bytes, heavy.filename, heavy.mime, heavy.mode);
    const sequentialMs = Number(process.hrtime.bigint() - sequentialStart) / 1e6;
    concurrentSpeedup = concurrentMs > 0 ? sequentialMs / concurrentMs : null;
  }

  return {
    iterations,
    payloadBytes: heavy.bytes.length,
    rustAvailable,
    ts: { totalMs: tsBlockMs, mainThreadBlockMs: tsBlockMs, callsPerSecond: iterations / (tsBlockMs / 1000) },
    native,
    latencySpeedup: native ? tsBlockMs / native.totalMs : null,
    blockingReduction: native && native.mainThreadBlockMs > 0 ? tsBlockMs / native.mainThreadBlockMs : null,
    concurrentSpeedup,
    parityMismatches: await inspectionParityMismatches()
  };
}

if (process.argv[1] !== undefined && __pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = await runInspectionBenchmark();
  const fmt = (value: number) => Math.round(value).toLocaleString("en-US");
  const perCall = (total: number) => (total / result.iterations).toFixed(2);
  console.log(`Inspection benchmark (inspectUntrustedContent), ${fmt(result.iterations)} inspectii pe arhiva de ${fmt(result.payloadBytes)} bytes`);
  console.log(`- TS fallback (sincron): ${perCall(result.ts.mainThreadBlockMs)}ms blocare main thread / inspectie, ${fmt(result.ts.callsPerSecond)} inspectii/s`);
  if (result.native) {
    console.log(`- Rust async (AsyncTask): ${perCall(result.native.mainThreadBlockMs)}ms blocare main thread / inspectie, latenta ${perCall(result.native.totalMs)}ms, ${fmt(result.native.callsPerSecond)} inspectii/s`);
    console.log(`- Reducere blocare event loop: ${result.blockingReduction ? result.blockingReduction.toFixed(2) : "-"}x`);
    console.log(`- Latenta secventiala native vs TS: ${result.latencySpeedup ? result.latencySpeedup.toFixed(2) : "-"}x`);
    console.log(`- ${CONCURRENT_ATTACHMENTS} atasamente concurente (Rust paralel vs TS secvential): ${result.concurrentSpeedup ? result.concurrentSpeedup.toFixed(2) : "-"}x`);
  } else {
    console.log("- Rust async: indisponibil (addon-ul nativ nu a fost incarcat).");
  }
  console.log(`- Paritate native==TS: ${result.parityMismatches.length === 0 ? "OK" : JSON.stringify(result.parityMismatches)}`);
}
