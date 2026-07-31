import { createMetrics } from "../../app/health/metrics.js";
import { createMetricRecorders } from "../../app/health/metricRecorders.js";
import { createSchedulers } from "../../app/appRuntime.js";
import { moduleContext } from "../moduleContextStub.js";
import test from "node:test";
import { stubRuntimePorts } from "./runtimePortStubs.js";
import assert from "node:assert/strict";


interface OutboxWorkerOpts { isPaused: () => Promise<boolean> }

function buildDeps(getOutboxPaused: unknown, outboxEnabled = false) {
  let capturedIsPaused: (() => Promise<boolean>) | undefined;
  const deps = {
    ports: stubRuntimePorts(),
    mongoose: {}, performance: { now: () => 0 }, crypto: {},
    createCronController: () => ({ scheduleNextCron() { }, runCronCycle: async () => { }, stop() { }, getHealthSnapshot() { return {}; } }),
    createOutboxWorker: (opts: OutboxWorkerOpts) => { capturedIsPaused = opts.isPaused; return { start() { }, stop() { } }; },
    createHousekeeping: () => ({ start() { }, stop: async () => { } }),
    scrapers: { cleanEnrichedCache() { }, getEnrichedCacheSize: () => 0 },
    errorMessage: (e: unknown) => String(e), errorDetail: (e: unknown) => String(e),
    commands: { drainOutbox: async () => ({}) },
    mongo: {
      logger: () => { }, env: { PORT: 3000, NOTIFICATION_OUTBOX_ENABLED: outboxEnabled }, parseEnvNumber: (_n: string, d: number) => d,
      acquireDbLock: async () => "token", renewDbLock: async () => true, releaseDbLock: async () => { },
      adminAlert: async () => { }, requestContext: {}, getOutboxPaused, cleanGuildCache() { }
    }
  };
  const services = { client: {}, metrics: createMetrics(), recorders: createMetricRecorders(createMetrics()), lifecycle: { isShuttingDown: false }, config: {}, games: [], rateLimiter: { check: () => true, prune() { }, size: 0, retryAfterSeconds: 1 } };
  return { deps, services, getCaptured: () => capturedIsPaused };
}

test("createSchedulers cu outbox activ (flag injectat in env): isPaused e cablat din getOutboxPaused si nu crapa", async () => {
  const { deps, services, getCaptured } = buildDeps(async () => true, true);
  const schedulers = createSchedulers(moduleContext<Parameters<typeof createSchedulers>[0]>(deps), moduleContext<Parameters<typeof createSchedulers>[1]>(services));
  assert.equal(schedulers.outboxEnabled, true, "env.NOTIFICATION_OUTBOX_ENABLED=true -> outboxEnabled (citit din env injectat, nu din process.env)");
  const isPaused = getCaptured();
  assert.equal(typeof isPaused, "function", "isPaused este cablat in worker");
  const result = await isPaused!();
  assert.equal(result, true, "isPaused deleaga corect la getOutboxPaused (nu crapa)");
});

test("createSchedulers cu outbox dezactivat (flag absent in env): outboxEnabled e false", () => {
  const { deps, services } = buildDeps(async () => false);
  const schedulers = createSchedulers(moduleContext<Parameters<typeof createSchedulers>[0]>(deps), moduleContext<Parameters<typeof createSchedulers>[1]>(services));
  assert.equal(schedulers.outboxEnabled, false, "fara flag in env -> outboxEnabled false");
});

test("createSchedulers: fara getOutboxPaused in mongo, isPaused() arunca (clasa de bug P0.1 — dep lipsa in main.ts)", async () => {
  const { deps, services, getCaptured } = buildDeps(undefined);
  createSchedulers(moduleContext<Parameters<typeof createSchedulers>[0]>(deps), moduleContext<Parameters<typeof createSchedulers>[1]>(services));
  const isPaused = getCaptured();
  assert.equal(typeof isPaused, "function");
  await assert.rejects(async () => isPaused!(), /is not a function|getOutboxPaused/,
    "fara getOutboxPaused cablat, worker-ul ar crapa la verificarea de pauza — exact ce prinde acum satisfies AppRuntimeDeps in main.ts");
});
