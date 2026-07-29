import test from "node:test";
import assert from "node:assert/strict";

import { createMetrics } from "../../app/health/metrics.js";
import { createMetricRecorders } from "../../app/health/metricRecorders.js";

test("recorderele scriu in acelasi magazin de contoare, fiecare pe campul lui", () => {
  const metrics = createMetrics();
  const recorders = createMetricRecorders(metrics);

  recorders.security.threatDeleted();
  recorders.security.threatDeleteFailed();
  recorders.security.botAddBlocked();
  recorders.security.runtimeErrored();
  recorders.http.fetchSucceeded();
  recorders.http.fetchFailed();
  recorders.http.retried();
  recorders.http.rateLimited();
  recorders.redis.cacheHit();
  recorders.cron.ran();

  assert.equal(metrics.securityThreatsDeleted, 1);
  assert.equal(metrics.securityThreatDeleteFailures, 1);
  assert.equal(metrics.securityBotAddsBlocked, 1);
  assert.equal(metrics.securityRuntimeErrors, 1);
  assert.equal(metrics.fetchSuccess, 1);
  assert.equal(metrics.fetchFail, 1);
  assert.equal(metrics.httpRetries, 1);
  assert.equal(metrics.rateLimitHits, 1);
  assert.equal(metrics.redisCacheHit, 1);
  assert.equal(metrics.cronRuns, 1);
});

test("un recorder nu poate atinge campurile altui domeniu", () => {
  const metrics = createMetrics();
  const recorders = createMetricRecorders(metrics);
  recorders.redis.errored();
  recorders.redis.errored();
  assert.equal(metrics.redisErrors, 2);
  assert.equal(metrics.securityRuntimeErrors, 0, "erorile Redis nu se scurg in contorul de securitate");
  assert.equal(metrics.cronErrors, 0);
});

test("revenirile de delegare se pot contoriza si in bloc, nu doar cate una", () => {
  const metrics = createMetrics();
  const recorders = createMetricRecorders(metrics);
  recorders.permissionDelegation.reverted();
  recorders.permissionDelegation.reverted(4);
  assert.equal(metrics.permissionDelegationsReverted, 5);
});

test("recorderul de inspector seteaza starea de sandbox, dar incrementeaza killurile", () => {
  const metrics = createMetrics();
  const recorders = createMetricRecorders(metrics);
  recorders.inspector.sandboxApplied(true);
  recorders.inspector.sandboxApplied(true);
  recorders.inspector.processKilled();
  recorders.inspector.processKilled();
  recorders.inspector.processRestarted(3);
  recorders.inspector.scanTimedOut();
  assert.equal(metrics.nativeInspectorSandboxed, 1, "sandbox e o stare, nu un contor");
  assert.equal(metrics.nativeInspectorKills, 2);
  assert.equal(metrics.nativeInspectorRestarts, 3, "restarturile vin ca total, nu ca increment");
  assert.equal(metrics.nativeInspectorTimeouts, 1);
  recorders.inspector.sandboxApplied(false);
  assert.equal(metrics.nativeInspectorSandboxed, 0);
});

test("recorderul motorului de amenintari tine versiunile si esecurile pe motiv", () => {
  const metrics = createMetrics();
  const recorders = createMetricRecorders(metrics);

  assert.deepEqual(recorders.threatEngine.knownVersions(), { engine: "", database: "" });
  recorders.threatEngine.scanned(1_000);
  recorders.threatEngine.versionsObserved({ engine: "1.4.2", database: "27234" });
  assert.deepEqual(recorders.threatEngine.knownVersions(), { engine: "1.4.2", database: "27234" });

  recorders.threatEngine.versionsObserved({ engine: "", database: "27235" });
  assert.deepEqual(
    recorders.threatEngine.knownVersions(),
    { engine: "1.4.2", database: "27235" },
    "o versiune goala nu sterge ce se stia deja"
  );

  recorders.threatEngine.versionChanged();
  recorders.threatEngine.probeFailed("http-status");
  recorders.threatEngine.probeFailed("http-status");
  recorders.threatEngine.probeFailed("transport");

  assert.equal(metrics.threatEngineScans, 1);
  assert.equal(metrics.threatEngineLastScanAt, 1_000);
  assert.equal(metrics.threatEngineVersionChanges, 1);
  assert.deepEqual(metrics.threatEngineFailures, { "http-status": 2, transport: 1 });
});

test("un contor absent din magazin porneste de la zero, nu produce NaN", () => {
  const metrics = createMetrics();
  metrics.securityThreatsDeleted = undefined;
  const recorders = createMetricRecorders(metrics);
  recorders.security.threatDeleted();
  assert.equal(metrics.securityThreatsDeleted, 1);
});
