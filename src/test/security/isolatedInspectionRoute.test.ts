import test from "node:test";
import assert from "node:assert/strict";

import { createIsolatedInspectionRouter } from "../../features/command-security/isolatedInspection.js";
import type { IsolatedInspectorClient } from "../../features/command-security/isolatedInspection.js";
import {
  decideIsolation,
  findInspectorBinary,
  inspectorBinaryCandidates,
  readIsolationSetting,
  readProcessCount
} from "../../features/command-security/nativeInspectorRouting.js";
import { DEFAULT_INSPECTION_LIMITS } from "../../features/command-security/passiveArchiveInspection.js";
import type { InspectionReport } from "../../features/command-security/passiveArchiveInspection.js";

const BINARY = "/app/src/native/native-inspector";

function report(reason: string): InspectionReport {
  return { status: "inspected", indicators: [], reason, entriesInspected: 1, expandedBytes: 0, elapsedMs: 1 };
}

test("productia Linux ruleaza inspectia izolat, fara sa i se ceara explicit", () => {
  const decision = decideIsolation({ setting: "auto", platform: "linux", production: true, binaryPath: BINARY });
  assert.equal(decision.isolated, true, "asta e chiar implicitul cerut de review: sandbox in productie Linux");
});

test("in afara productiei Linux implicitul ramane addon-ul in-proces", () => {
  for (const input of [
    { setting: "auto", platform: "win32", production: true },
    { setting: "auto", platform: "linux", production: false }
  ] as const) {
    const decision = decideIsolation({ ...input, binaryPath: BINARY });
    assert.equal(decision.isolated, false, `${input.platform}/${input.production} nu poate exersa filtrul de syscall`);
    assert.ok(decision.reason.length > 0, "motivul intra in log, nu se pierde");
  }
});

test("fara binar nu se pretinde izolare, nici macar cand e ceruta explicit", () => {
  const forced = decideIsolation({ setting: "on", platform: "linux", production: true, binaryPath: null });
  assert.equal(forced.isolated, false, "un `on` fara binar ar insemna doar esecuri de spawn la fiecare atasament");
  assert.match(forced.reason, /binarul/);
});

test("comutatorul explicit bate platforma in ambele sensuri", () => {
  assert.equal(decideIsolation({ setting: "on", platform: "darwin", production: false, binaryPath: BINARY }).isolated, true);
  assert.equal(decideIsolation({ setting: "off", platform: "linux", production: true, binaryPath: BINARY }).isolated, false);
});

test("valorile de mediu sunt citite tolerant, dar fara surprize", () => {
  assert.equal(readIsolationSetting(undefined), "auto");
  assert.equal(readIsolationSetting(" ON "), "on");
  assert.equal(readIsolationSetting("false"), "off");
  assert.equal(readIsolationSetting("poate"), "auto", "o valoare necunoscuta nu porneste si nu opreste nimic pe tacute");
  assert.equal(readProcessCount(undefined), 2);
  assert.equal(readProcessCount("0"), 2, "zero procese ar bloca orice inspectie");
  assert.equal(readProcessCount("99"), 8, "numarul de procese ramane plafonat");
});

test("calea explicita din mediu are prioritate fata de cautarea langa addon", () => {
  const explicit = inspectorBinaryCandidates(import.meta.url, "/opt/inspector");
  assert.deepEqual(explicit, ["/opt/inspector"]);
  const discovered = inspectorBinaryCandidates(import.meta.url, undefined);
  assert.ok(discovered.length > 1, "fara override se incearca si build-ul local, nu doar imaginea");
  assert.equal(findInspectorBinary(discovered, () => false), null);
  assert.equal(findInspectorBinary(discovered, file => file === discovered[1]), discovered[1]);
});

function clientThat(behaviour: (calls: number) => { report: InspectionReport | null; failure: string }): { client: IsolatedInspectorClient; calls: () => number; stopped: () => number } {
  let calls = 0;
  let stopped = 0;
  const client: IsolatedInspectorClient = {
    inspect: async () => {
      calls += 1;
      return { ...behaviour(calls), sandboxed: true };
    },
    stop: () => { stopped += 1; }
  };
  return { client, calls: () => calls, stopped: () => stopped };
}

test("cand izolarea e oprita, routerul nu porneste niciun proces", async () => {
  let created = 0;
  const router = createIsolatedInspectionRouter({
    setting: "off",
    platform: "linux",
    production: true,
    binaryPath: BINARY,
    processCount: 2,
    createClient: () => { created += 1; return clientThat(() => ({ report: report("ok"), failure: "" })).client; }
  });

  assert.equal(await router.inspect(Buffer.from("x"), "a.zip", "application/zip", "archive", DEFAULT_INSPECTION_LIMITS), null);
  assert.equal(created, 0, "un proces pornit degeaba ar consuma memorie pe fiecare instanta");
});

test("verdictul procesului izolat ajunge intact la apelant", async () => {
  const spy = clientThat(() => ({ report: report("inspectat in sandbox"), failure: "" }));
  const router = createIsolatedInspectionRouter({
    setting: "auto",
    platform: "linux",
    production: true,
    binaryPath: BINARY,
    processCount: 1,
    createClient: () => spy.client
  });

  const result = await router.inspect(Buffer.from("x"), "a.zip", "application/zip", "archive", DEFAULT_INSPECTION_LIMITS);
  assert.equal(result?.reason, "inspectat in sandbox");
  assert.equal(spy.calls(), 1);
});

test("un job fara verdict nu se preface in raport gol", async () => {
  const logs: string[] = [];
  const spy = clientThat(() => ({ report: null, failure: "procesul a fost oprit (SIGSYS)" }));
  const router = createIsolatedInspectionRouter({
    setting: "auto",
    platform: "linux",
    production: true,
    binaryPath: BINARY,
    processCount: 1,
    createClient: () => spy.client,
    logger: (level, _context, message) => { logs.push(`${level}:${message}`); }
  });

  const result = await router.inspect(Buffer.from("x"), "a.zip", "application/zip", "archive", DEFAULT_INSPECTION_LIMITS);
  assert.equal(result, null, "null inseamna `fara verdict`, deci apelantul decide singur calea de rezerva");
  assert.ok(logs.some(entry => entry.startsWith("WARN")), "esecul rutei izolate e vizibil in log, nu tacut");
});

test("procesele se refolosesc si nu se depaseste plafonul, oricat de multe atasamente vin odata", async () => {
  const clients: IsolatedInspectorClient[] = [];
  let inFlight = 0;
  let peak = 0;
  const release: Array<() => void> = [];
  const router = createIsolatedInspectionRouter({
    setting: "auto",
    platform: "linux",
    production: true,
    binaryPath: BINARY,
    processCount: 2,
    createClient: () => {
      const client: IsolatedInspectorClient = {
        inspect: async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise<void>(resolve => { release.push(resolve); });
          inFlight -= 1;
          return { report: report("ok"), sandboxed: true, failure: "" };
        },
        stop: () => undefined
      };
      clients.push(client);
      return client;
    }
  });

  const pending = Array.from({ length: 5 }, () => router.inspect(Buffer.from("x"), "a.zip", "application/zip", "archive", DEFAULT_INSPECTION_LIMITS));
  let settled = 0;
  for (const job of pending) void job.then(() => { settled += 1; });
  for (let guard = 0; guard < 200 && settled < pending.length; guard++) {
    release.shift()?.();
    await new Promise(resolve => setImmediate(resolve));
  }
  const results = await Promise.all(pending);

  assert.equal(results.filter(entry => entry !== null).length, 5, "toate atasamentele primesc verdict");
  assert.equal(clients.length, 2, "pool-ul nu creste peste NATIVE_INSPECTOR_PROCESSES");
  assert.ok(peak <= 2, "doua cereri nu ajung niciodata pe acelasi proces in acelasi timp");
});

test("oprirea inchide fiecare proces pornit", async () => {
  const spies = [clientThat(() => ({ report: report("ok"), failure: "" })), clientThat(() => ({ report: report("ok"), failure: "" }))];
  let index = 0;
  const router = createIsolatedInspectionRouter({
    setting: "on",
    platform: "linux",
    production: false,
    binaryPath: BINARY,
    processCount: 2,
    createClient: () => spies[index++].client
  });

  await Promise.all([
    router.inspect(Buffer.from("x"), "a.zip", "application/zip", "archive", DEFAULT_INSPECTION_LIMITS),
    router.inspect(Buffer.from("y"), "b.zip", "application/zip", "archive", DEFAULT_INSPECTION_LIMITS)
  ]);
  router.stop();

  assert.deepEqual(spies.map(spy => spy.stopped()), [1, 1], "procesele ramase in viata dupa shutdown ar tine nodul deschis");
});
