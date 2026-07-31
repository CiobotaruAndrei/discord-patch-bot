import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  createNativeInspectorClient,
  encodeRequest,
  type SpawnInspector
} from "../../features/command-security/nativeInspectorProcess.js";
import { DEFAULT_INSPECTION_LIMITS } from "../../features/command-security/passiveArchiveInspection.js";
import { createMetrics } from "../../app/health/metrics.js";
import { createMetricRecorders } from "../../app/health/metricRecorders.js";
import type { BotMetrics } from "../../app/health/metricsTypes.js";

function metrics(): BotMetrics {
  return createMetrics();
}

function encodeText(value: string): Buffer {
  const raw = Buffer.from(value, "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(raw.length, 0);
  return Buffer.concat([header, raw]);
}

function encodeResponse(
  status: string,
  reason: string,
  indicators: string[],
  sandboxed: boolean,
  gaps: { uninspectableFormat?: string; analysisBlindSpots?: string[] } = {}
): Buffer {
  const head = Buffer.alloc(6);
  head.write("DPBO", 0, "ascii");
  head.writeUInt16LE(2, 4);
  const count = Buffer.alloc(4);
  count.writeUInt32LE(indicators.length, 0);
  const tail = Buffer.alloc(22);
  tail.writeUInt32LE(3, 0);
  tail.writeBigUInt64LE(4096n, 4);
  tail.writeDoubleLE(12.5, 12);
  tail[20] = sandboxed ? 1 : 0;
  tail[21] = gaps.uninspectableFormat === undefined ? 0 : 1;
  const spots = gaps.analysisBlindSpots ?? [];
  const spotCount = Buffer.alloc(4);
  spotCount.writeUInt32LE(spots.length, 0);
  return Buffer.concat([
    head,
    encodeText(status),
    encodeText(reason),
    count,
    ...indicators.map(encodeText),
    tail,
    ...(gaps.uninspectableFormat === undefined ? [] : [encodeText(gaps.uninspectableFormat)]),
    spotCount,
    ...spots.map(encodeText)
  ]);
}

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  written: Buffer[] = [];
  stdin = { write: (chunk: Buffer) => { this.written.push(chunk); return true; } };
  killed = false;
  kill(): boolean {
    this.killed = true;
    return true;
  }
  ready(sandboxed: boolean): void {
    const frame = Buffer.alloc(5);
    frame.write("DPBR", 0, "ascii");
    frame[4] = sandboxed ? 1 : 0;
    this.stdout.emit("data", frame);
  }
}

function clientWith(child: FakeChild, overrides: Record<string, unknown> = {}) {
  const collected = metrics();
  const spawnProcess: SpawnInspector = () => {
    queueMicrotask(() => child.ready(true));
    return child;
  };
  const client = createNativeInspectorClient({
    binaryPath: "native-inspector",
    spawnProcess,
    metrics: createMetricRecorders(collected).inspector,
    requestTimeoutMs: 80,
    ...overrides
  });
  return { client, collected };
}

test("cererea codificata poarta semnatura, versiunea si continutul intact", () => {
  const content = Buffer.from("PK continut", "latin1");
  const frame = encodeRequest(content, "arhiva.zip", "application/zip", "archive", DEFAULT_INSPECTION_LIMITS);

  assert.equal(frame.subarray(0, 4).toString("ascii"), "DPBI");
  assert.equal(frame.readUInt16LE(4), 2);
  assert.ok(frame.subarray(frame.length - content.length).equals(content), "continutul ajunge byte-cu-byte, fara reincodare");
});

test("un raspuns complet este decodat si pastreaza starea de sandbox raportata de proces", async () => {
  const child = new FakeChild();
  const { client } = clientWith(child);
  const pending = client.inspect(Buffer.from("x"), "a.zip", "application/zip", "archive", DEFAULT_INSPECTION_LIMITS);
  setImmediate(() => child.stdout.emit("data", encodeResponse("uncertain", "arhiva criptata", ["arhiva criptata"], true)));

  const outcome = await pending;
  assert.equal(outcome.failure, "");
  assert.equal(outcome.report?.status, "uncertain");
  assert.deepEqual(outcome.report?.indicators, ["arhiva criptata"]);
  assert.equal(outcome.sandboxed, true);
});

test("un raspuns sosit in doua bucati este reasamblat, nu pierdut", async () => {
  const child = new FakeChild();
  const { client } = clientWith(child);
  const pending = client.inspect(Buffer.from("x"), "a.zip", "application/zip", "archive", DEFAULT_INSPECTION_LIMITS);
  const frame = encodeResponse("inspected", "fara indicatori", [], true);
  setImmediate(() => {
    child.stdout.emit("data", frame.subarray(0, 9));
    child.stdout.emit("data", frame.subarray(9));
  });

  const outcome = await pending;
  assert.equal(outcome.report?.status, "inspected");
});

test("procesul ucis in timpul unui job NU produce raport, contorizeaza kill-ul si cere repornire", async () => {
  const child = new FakeChild();
  const { client, collected } = clientWith(child);
  const pending = client.inspect(Buffer.from("x"), "a.zip", "application/zip", "archive", DEFAULT_INSPECTION_LIMITS);
  setImmediate(() => child.emit("exit", null, "SIGSYS"));

  const outcome = await pending;
  assert.equal(outcome.report, null, "un proces ucis nu poate produce un verdict");
  assert.match(outcome.failure, /SIGSYS/);
  assert.equal(collected.nativeInspectorKills, 1);
  assert.equal(collected.nativeInspectorRestarts, 1);
  assert.equal(client.restartCount(), 1);
});

test("un job care depaseste termenul este oprit, contorizat si nu intoarce raport", async () => {
  const child = new FakeChild();
  const { client, collected } = clientWith(child);

  const outcome = await client.inspect(Buffer.from("x"), "a.zip", "application/zip", "archive", DEFAULT_INSPECTION_LIMITS);
  assert.equal(outcome.report, null);
  assert.match(outcome.failure, /a depasit 80 ms/);
  assert.equal(collected.nativeInspectorTimeouts, 1);
  assert.equal(child.killed, true, "procesul blocat este oprit, nu lasat sa se acumuleze");
});

test("un raspuns cu semnatura gresita nu e interpretat: procesul e repornit si jobul ramane fara verdict", async () => {
  const child = new FakeChild();
  const { client, collected } = clientWith(child);
  const pending = client.inspect(Buffer.from("x"), "a.zip", "application/zip", "archive", DEFAULT_INSPECTION_LIMITS);
  setImmediate(() => child.stdout.emit("data", Buffer.from("XXXXXXXXXXXX", "ascii")));

  const outcome = await pending;
  assert.equal(outcome.report, null);
  assert.match(outcome.failure, /DPBO/);
  assert.equal(collected.nativeInspectorRestarts, 1);
});

test("lipsa filtrului de syscall este raportata explicit, nu tacuta", async () => {
  const child = new FakeChild();
  const logs: string[] = [];
  const spawnProcess: SpawnInspector = () => {
    queueMicrotask(() => child.ready(false));
    return child;
  };
  const collected = metrics();
  const client = createNativeInspectorClient({
    binaryPath: "native-inspector",
    spawnProcess,
    metrics: createMetricRecorders(collected).inspector,
    requestTimeoutMs: 80,
    logger: (level, _context, message) => { logs.push(`${level}:${message}`); }
  });

  const pending = client.inspect(Buffer.from("x"), "a.zip", "application/zip", "archive", DEFAULT_INSPECTION_LIMITS);
  setImmediate(() => child.stdout.emit("data", encodeResponse("inspected", "ok", [], false)));
  const outcome = await pending;

  assert.equal(outcome.sandboxed, false);
  assert.equal(collected.nativeInspectorSandboxed, 0);
  assert.ok(logs.some(entry => entry.startsWith("WARN") && /FARA filtru de syscall/.test(entry)));
});

test("golurile de acoperire calatoresc prin proces, nu se pierd la granita", async () => {
  const child = new FakeChild();
  const { client } = clientWith(child);
  const pending = client.inspect(Buffer.from("x"), "a.rar", "application/x-rar", "archive", DEFAULT_INSPECTION_LIMITS);
  setImmediate(() => child.stdout.emit("data", encodeResponse("uncertain", "header criptat", [], true, {
    uninspectableFormat: "rar-cu-header-criptat",
    analysisBlindSpots: ["sectiune impachetata"]
  })));

  const outcome = await pending;
  assert.equal(outcome.report?.uninspectableFormat, "rar-cu-header-criptat");
  assert.deepEqual(outcome.report?.analysisBlindSpots, ["sectiune impachetata"]);
});

test("absenta unui format neinspectat nu devine sir gol", async () => {
  const child = new FakeChild();
  const { client } = clientWith(child);
  const pending = client.inspect(Buffer.from("x"), "a.zip", "application/zip", "archive", DEFAULT_INSPECTION_LIMITS);
  setImmediate(() => child.stdout.emit("data", encodeResponse("inspected", "fara indicatori", [], true)));

  const outcome = await pending;
  assert.equal(outcome.report?.uninspectableFormat, undefined);
  assert.equal(outcome.report?.analysisBlindSpots, undefined);
});

test("cererea poarta si raportul maxim de compresie cerut de apelant", () => {
  const frame = encodeRequest(Buffer.from("PK"), "a.zip", "application/zip", "archive", { ...DEFAULT_INSPECTION_LIMITS, maxCompressionRatio: 42 });
  const numbersAt = 6 + (4 + "a.zip".length) + (4 + "application/zip".length) + (4 + "archive".length);

  assert.equal(frame.readDoubleLE(numbersAt + 16), 42, "fara campul asta, plafonul de zip bomb cerut ar fi ignorat tacut in proces");
});

test("un al doilea job concurent este refuzat, nu suprapus peste primul", async () => {
  const child = new FakeChild();
  const { client } = clientWith(child);
  const first = client.inspect(Buffer.from("x"), "a.zip", "application/zip", "archive", DEFAULT_INSPECTION_LIMITS);
  await new Promise(resolve => setImmediate(resolve));
  const second = await client.inspect(Buffer.from("y"), "b.zip", "application/zip", "archive", DEFAULT_INSPECTION_LIMITS);

  assert.equal(second.report, null);
  assert.match(second.failure, /job in lucru/, "suprascrierea asteptarii ar fi dus verdictul unui atasament la alt atasament");
  child.stdout.emit("data", encodeResponse("inspected", "ok", [], true));
  assert.equal((await first).report?.reason, "ok", "primul job ramane legat de raspunsul lui");
});
