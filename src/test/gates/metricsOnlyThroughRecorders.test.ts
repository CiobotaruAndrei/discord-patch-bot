import test from "node:test";
import assert from "node:assert/strict";

import { loadModulesIn, mutatedPropertyPaths, membersOf, calls } from "./sourceStructureQueries.js";
import type { ModuleQuery } from "./sourceStructureQueries.js";
import { createMetrics } from "../../app/health/metrics.js";
import { createMetricRecorders } from "../../app/health/metricRecorders.js";

const READERS: readonly string[] = ["metricsRegistry.ts", "metricRecorders.ts", "metrics.ts"];

function runtimeModules(): ModuleQuery[] {
  const isSource = (name: string) => name.endsWith(".ts") && !READERS.includes(name);
  return [
    ...loadModulesIn(["app"], isSource),
    ...loadModulesIn(["app", "health"], isSource),
    ...loadModulesIn(["app", "scheduler"], isSource),
    ...loadModulesIn(["app", "runtime"], isSource),
    ...loadModulesIn(["app", "lifecycle"], isSource)
  ];
}

test("niciun modul de runtime nu mai scrie direct intr-un camp de metrica", () => {
  const offenders: string[] = [];
  for (const query of runtimeModules()) {
    for (const mutation of mutatedPropertyPaths(query)) {
      if (!/^metrics\.[a-zA-Z]/.test(mutation.path) && !/^deps\.metrics\.[a-zA-Z]/.test(mutation.path)) continue;
      offenders.push(`${query.relativePath}:${mutation.line} ${mutation.path}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "un `metrics.X++` imprastiat prin runtime inseamna ca numele si semantica metricii traiesc in locul care se intampla " +
      "sa o incrementeze: aceeasi metrica ajunge scrisa cu `++`, cu `+= n` si cu `?? 0 + 1` in fisiere diferite, si nimeni " +
      `nu poate raspunde dintr-un singur loc ce o mai misca (${offenders.join(", ")})`
  );
});

test("recorderele acopera fiecare familie de metrici pe care o scrie runtime-ul", () => {
  const recorders = createMetricRecorders(createMetrics());
  for (const family of [
    "security", "inspector", "threatEngine", "permissionDelegation", "http", "redis", "cron",
    "outbox", "command", "channelLockRecovery", "moderationCleanup", "threatSurface", "httpServer"
  ]) {
    assert.ok(family in recorders, `familia ${family} are un recorder`);
  }
});

test("contractul de recordere e in shared, ca sa nu lege consumatorii de forma completa a metricilor", () => {
  const ports = loadModulesIn(["shared"], name => name === "metricRecorderPorts.ts");
  assert.equal(ports.length, 1, "contractul exista in shared");
  const [contract] = ports;
  assert.deepEqual(
    membersOf(contract, "MetricRecorders").map(member => member.name).sort(),
    [
      "channelLockRecovery", "command", "cron", "http", "httpServer", "inspector", "moderationCleanup",
      "outbox", "permissionDelegation", "redis", "security", "threatEngine", "threatSurface"
    ],
    "orice familie noua trece prin contractul din shared, nu printr-un camp scris direct"
  );
});

test("recorderele chiar muta metricile pe care le promit", () => {
  const metrics = createMetrics();
  const recorders = createMetricRecorders(metrics);

  recorders.cron.ran();
  recorders.cron.ran();
  assert.equal(metrics.cronRuns, 2);
  assert.equal(recorders.cron.currentCycle(), 2, "numarul ciclului se citeste tot prin recorder, nu din campul brut");

  recorders.outbox.drained({ sent: 3, markSentFailures: 1, queued: 7, oldestJobAgeMs: 90_000 }, 1_700_000_000_000);
  assert.equal(metrics.outboxDrains, 1);
  assert.equal(metrics.outboxSent, 3);
  assert.equal(metrics.outboxMarkSentFailures, 1);
  assert.equal(metrics.outboxQueueDepth, 7, "marimile de stare se suprascriu, nu se aduna");
  assert.equal(metrics.outboxOldestJobAgeSeconds, 90, "vechimea se raporteaza in secunde");
  assert.equal(metrics.outboxLastDrainAt, 1_700_000_000_000);

  recorders.outbox.drained({ sent: 2, queued: 4 }, 1_700_000_001_000);
  assert.equal(metrics.outboxSent, 5, "counterele se aduna intre drenari");
  assert.equal(metrics.outboxQueueDepth, 4);

  recorders.command.ran("ping", 12);
  recorders.command.ran("ping", 8);
  recorders.command.errored("backup");
  assert.deepEqual(metrics.commandRuns, { ping: 2 });
  assert.equal(metrics.commandDurationMsTotal.ping, 20);
  assert.deepEqual(metrics.commandErrors, { backup: 1 });

  recorders.channelLockRecovery.converged(3);
  recorders.channelLockRecovery.converged(2);
  assert.equal(metrics.channelLockRecoveriesConverged, 5);

  recorders.threatSurface.yaraRulesetObserved({ loaded: true, available: true, ruleCount: 42 });
  assert.equal(metrics.yaraRulesLoaded, 42);
  recorders.threatSurface.reset();
  assert.equal(metrics.yaraRulesLoaded, 0);
  assert.equal(metrics.yaraEngineAvailable, 0);
});

test("o drenare fara campuri optionale nu strica metricile de stare deja raportate", () => {
  const metrics = createMetrics();
  const recorders = createMetricRecorders(metrics);
  recorders.outbox.drained({ queued: 9, futureScheduledCount: 4 }, 1);
  recorders.outbox.drained({ sent: 1 }, 2);
  assert.equal(metrics.outboxQueueDepth, 9, "un rezultat fara `queued` nu inseamna coada zero");
  assert.equal(metrics.outboxFutureScheduledJobs, 4);
});

test("compunerea creeaza recorderele o singura data si le paseaza mai departe", () => {
  const [services] = loadModulesIn(["app", "runtime"], name => name === "runtimeServices.ts");
  assert.ok(
    calls(services).some(call => call.callee === "createMetricRecorders"),
    "recorderele se construiesc in serviciile de runtime, langa metricile pe care le inchid"
  );
  const [runtime] = loadModulesIn(["app"], name => name === "appRuntime.ts");
  assert.ok(
    !calls(runtime).some(call => call.callee === "createMetricRecorders"),
    "compunerea nu isi mai face a doua instanta de recordere peste aceleasi metrici"
  );
});
