import test from "node:test";
import assert from "node:assert/strict";

import { createThreatEngineMonitor } from "../../features/command-security/threatEngineMonitor.js";
import type { ReputationEngineDetails } from "../../features/command-security/reputationEngine.js";

type MonitorMetrics = Parameters<typeof createThreatEngineMonitor>[0]["metrics"];

function details(overrides: Partial<ReputationEngineDetails> = {}): ReputationEngineDetails {
  return {
    verdict: "clean",
    signature: "",
    engineVersion: "1.4.2",
    databaseVersion: "27234",
    contentSha256: "abc",
    complete: true,
    ...overrides
  };
}

test("fiecare raspuns reusit incrementeaza scanarile si actualizeaza momentul ultimei scanari", () => {
  const metrics: MonitorMetrics = {};
  let clock = 1_000;
  const monitor = createThreatEngineMonitor({ metrics, now: () => clock });

  monitor.onDetails(details());
  clock = 5_000;
  monitor.onDetails(details());

  assert.equal(metrics.threatEngineScans, 2);
  assert.equal(metrics.threatEngineLastScanAt, 5_000);
});

test("prima observare a versiunilor le retine fara sa numere o schimbare", () => {
  const metrics: MonitorMetrics = {};
  const logs: unknown[] = [];
  const monitor = createThreatEngineMonitor({ metrics, logger: (...entry) => { logs.push(entry); }, now: () => 0 });

  monitor.onDetails(details());

  assert.equal(metrics.threatEngineVersion, "1.4.2");
  assert.equal(metrics.threatEngineDatabaseVersion, "27234");
  assert.equal(metrics.threatEngineVersionChanges ?? 0, 0, "prima observare nu e o schimbare de versiune");
  assert.equal(logs.length, 1, "prima observare se logheaza ca sa existe context in audit");
});

test("o schimbare reala de versiune dupa prima observare e numarata si logata cu vechi si nou", () => {
  const metrics: MonitorMetrics = {};
  const logs: { meta?: unknown }[] = [];
  const monitor = createThreatEngineMonitor({
    metrics,
    logger: (_level, _context, _message, meta) => { logs.push({ meta }); },
    now: () => 0
  });

  monitor.onDetails(details());
  monitor.onDetails(details());
  assert.equal(metrics.threatEngineVersionChanges ?? 0, 0, "aceeasi versiune nu produce schimbari");

  monitor.onDetails(details({ databaseVersion: "27235" }));

  assert.equal(metrics.threatEngineVersionChanges, 1);
  assert.equal(metrics.threatEngineDatabaseVersion, "27235");
  const lastMeta = logs.at(-1)?.meta;
  assert.deepEqual(lastMeta, {
    engineVersion: { from: "1.4.2", to: "1.4.2" },
    databaseVersion: { from: "27234", to: "27235" }
  });
});

test("un raspuns fara metadate de versiune nu sterge versiunile deja observate", () => {
  const metrics: MonitorMetrics = {};
  const monitor = createThreatEngineMonitor({ metrics, now: () => 0 });

  monitor.onDetails(details());
  monitor.onDetails(details({ engineVersion: "", databaseVersion: "" }));

  assert.equal(metrics.threatEngineVersion, "1.4.2");
  assert.equal(metrics.threatEngineDatabaseVersion, "27234");
  assert.equal(metrics.threatEngineVersionChanges ?? 0, 0);
});

test("esecurile se numara separat pe motiv, fara sa se amestece", () => {
  const metrics: MonitorMetrics = {};
  const monitor = createThreatEngineMonitor({ metrics, now: () => 0 });

  monitor.onFailure("transport");
  monitor.onFailure("transport");
  monitor.onFailure("http-status");

  assert.deepEqual(metrics.threatEngineFailures, { transport: 2, "http-status": 1 });
  assert.equal(metrics.threatEngineScans ?? 0, 0, "un esec nu e o scanare reusita");
});
