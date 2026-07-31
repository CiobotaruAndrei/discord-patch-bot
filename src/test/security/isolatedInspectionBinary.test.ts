import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createNativeInspectorClient } from "../../features/command-security/nativeInspectorProcess.js";
import { createIsolatedInspectionRouter } from "../../features/command-security/isolatedInspection.js";
import {
  findInspectorBinary,
  inspectorBinaryCandidates
} from "../../features/command-security/nativeInspectorRouting.js";
import {
  DEFAULT_INSPECTION_LIMITS,
  inspectUntrustedContentFallback
} from "../../features/command-security/passiveArchiveInspection.js";

const binary = findInspectorBinary(inspectorBinaryCandidates(import.meta.url, process.env.NATIVE_INSPECTOR_BINARY), fs.existsSync);
const missing = binary === null;

function zipWith(name: string, payload: Buffer): Buffer {
  const nameBytes = Buffer.from(name, "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(payload.length, 18);
  header.writeUInt32LE(payload.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBytes, payload]);
}

test("binarul real produce acelasi verdict ca parserul TypeScript pentru acelasi continut", { skip: missing }, async () => {
  const router = createIsolatedInspectionRouter({
    setting: "on",
    platform: process.platform,
    production: false,
    binaryPath: binary,
    processCount: 1,
    createClient: path => createNativeInspectorClient({ binaryPath: path, requestTimeoutMs: 15_000 })
  });
  const archive = zipWith("instaleaza.exe", Buffer.from("MZ" + "\u0000".repeat(64), "latin1"));

  try {
    const isolated = await router.inspect(archive, "pachet.zip", "application/zip", "archive", DEFAULT_INSPECTION_LIMITS);
    const local = inspectUntrustedContentFallback(archive, "pachet.zip", "application/zip", "archive");

    assert.ok(isolated, "procesul real trebuie sa raspunda, altfel rutarea implicita ar cadea mereu pe rezerva");
    assert.equal(isolated.status, local.status, "statusul nu are voie sa difere intre proces si parserul de rezerva");
    assert.ok(isolated.indicators.length > 0, "un executabil impachetat ramane un indicator, oriunde ar fi inspectat");
  } finally {
    router.stop();
  }
});

test("procesul real serveste mai multe atasamente unul dupa altul, fara sa amestece verdictele", { skip: missing }, async () => {
  const router = createIsolatedInspectionRouter({
    setting: "on",
    platform: process.platform,
    production: false,
    binaryPath: binary,
    processCount: 2,
    createClient: path => createNativeInspectorClient({ binaryPath: path, requestTimeoutMs: 15_000 })
  });
  const curat = zipWith("citeste.txt", Buffer.from("doar text", "utf8"));
  const suspect = zipWith("payload.exe", Buffer.from("MZ" + "\u0000".repeat(64), "latin1"));

  try {
    const [primul, aldoilea, altreilea] = await Promise.all([
      router.inspect(curat, "a.zip", "application/zip", "archive", DEFAULT_INSPECTION_LIMITS),
      router.inspect(suspect, "b.zip", "application/zip", "archive", DEFAULT_INSPECTION_LIMITS),
      router.inspect(curat, "c.zip", "application/zip", "archive", DEFAULT_INSPECTION_LIMITS)
    ]);

    assert.deepEqual(primul?.indicators, [], "arhiva curata nu poate mosteni indicatorii vecinului de coada");
    assert.ok((aldoilea?.indicators.length ?? 0) > 0, "arhiva suspecta isi pastreaza indicatorii");
    assert.deepEqual(altreilea?.indicators, []);
  } finally {
    router.stop();
  }
});
