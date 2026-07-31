import { createRequire as __createRequire } from "node:module";
import { createMetrics } from "../../app/health/metrics.js";
import { createMetricRecorders } from "../../app/health/metricRecorders.js";
const require = __createRequire(import.meta.url);
import test from "node:test";
import { stubRuntimePorts } from "../app/runtimePortStubs.js";
import assert from "node:assert/strict";
import { createOutboxWorker } from "../../app/scheduler/outboxWorker.js";

import attachSystemState from "../../infra/mongo/systemState.js";
const { createSchedulers } = require("../../app/appRuntime") as {
  createSchedulers: (deps: unknown, services: unknown) => { outboxEnabled: boolean };
};

function makeSystemModel() {
  let doc: { _id: string; outboxPaused?: boolean } | null = null;
  return {
    findById(id: string) {
      return { lean: async () => (doc && doc._id === id ? { ...doc } : null) };
    },
    async findByIdAndUpdate(id: string, update: { $set?: Record<string, unknown> }) {
      if (!doc) doc = { _id: id };
      Object.assign(doc, update.$set || {});
      return { ...doc };
    }
  };
}

function realState() {
  const target: Record<string, unknown> = { SystemModel: makeSystemModel() };
  attachSystemState(target as object as Parameters<typeof attachSystemState>[0]);
  return {
    getOutboxPaused: target.getOutboxPaused as () => Promise<boolean>,
    setOutboxPaused: target.setOutboxPaused as (p: boolean) => Promise<void>
  };
}

function zeroMetrics() {
  return createMetrics();
}

test("P2.3: flux pause/resume end-to-end — starea persistata controleaza drenarea worker-ului real", async () => {
  const { getOutboxPaused, setOutboxPaused } = realState();
  let drainCalls = 0;
  const worker = createOutboxWorker({
    mongoose: { connection: { readyState: 1 } },
    client: { isReady: () => true, user: { id: "bot-1" }, channels: { fetch: async () => null } },
    logger: () => undefined,
    parseEnvNumber: (_n: string, d: number) => d,
    acquireDbLock: async () => "lock-token",
    renewDbLock: async () => true,
    releaseDbLock: async () => undefined,
    drainOutbox: async () => { drainCalls++; return { sent: 0, retried: 0, deadLettered: 0, queued: 0 }; },
    lifecycle: { isShuttingDown: false },
    metrics: createMetricRecorders(zeroMetrics()).outbox,
    adminAlert: async () => undefined,
    isPaused: () => getOutboxPaused(),
    errorMessage: (e: unknown) => String(e),
    drainLimit: 50, perJobBudgetMs: 7000
  });

  try {
    assert.equal(await getOutboxPaused(), false, "implicit nu e pe pauza");
    await worker.drainTick();
    assert.equal(drainCalls, 1, "nu pe pauza -> worker-ul drenza");

    await setOutboxPaused(true);
    assert.equal(await getOutboxPaused(), true, "/outbox pause -> stare persistata true");
    await worker.drainTick();
    assert.equal(drainCalls, 1, "pe pauza -> worker-ul NU mai drenza (drainCalls neschimbat)");

    await setOutboxPaused(false);
    assert.equal(await getOutboxPaused(), false, "/outbox resume -> stare persistata false");
    await worker.drainTick();
    assert.equal(drainCalls, 2, "dupa resume -> worker-ul drenza din nou");
  } finally {
    worker.stop();
  }
});

test("P2.3: NOTIFICATION_OUTBOX_ENABLED=true -> scheduler activeaza worker-ul si cableaza isPaused la starea reala", async () => {
  const { getOutboxPaused, setOutboxPaused } = realState();
  let capturedIsPaused: (() => Promise<boolean>) | undefined;
  const deps = {
    ports: stubRuntimePorts(),
    mongoose: {}, performance: { now: () => 0 }, crypto: {},
    createCronController: () => ({ scheduleNextCron() { }, runCronCycle: async () => { }, stop() { }, getHealthSnapshot() { return {}; } }),
    createOutboxWorker: (opts: { isPaused: () => Promise<boolean> }) => { capturedIsPaused = opts.isPaused; return { start() { }, stop() { } }; },
    createHousekeeping: () => ({ start() { }, stop: async () => { } }),
    scrapers: { cleanEnrichedCache() { }, getEnrichedCacheSize: () => 0 },
    errorMessage: (e: unknown) => String(e), errorDetail: (e: unknown) => String(e),
    commands: { drainOutbox: async () => ({}) },
    mongo: {
      logger: () => { }, env: { PORT: 3000, NOTIFICATION_OUTBOX_ENABLED: true }, parseEnvNumber: (_n: string, d: number) => d,
      acquireDbLock: async () => "token", renewDbLock: async () => true, releaseDbLock: async () => { },
      adminAlert: async () => { }, requestContext: {}, getOutboxPaused, cleanGuildCache() { }
    }
  };
  const services = { client: {}, metrics: createMetrics(), recorders: createMetricRecorders(createMetrics()), lifecycle: { isShuttingDown: false }, config: {}, games: [], rateLimiter: { check: () => true, prune() { }, size: 0, retryAfterSeconds: 1 } };

  const schedulers = createSchedulers(deps, services);
  assert.equal(schedulers.outboxEnabled, true, "flag-ul (injectat in env) activeaza outbox-ul");
  assert.equal(typeof capturedIsPaused, "function", "isPaused cablat in worker");
  assert.equal(await capturedIsPaused!(), false, "initial nu e pe pauza");
  await setOutboxPaused(true);
  assert.equal(await capturedIsPaused!(), true, "isPaused reflecta /outbox pause prin getOutboxPaused-ul real");
});
