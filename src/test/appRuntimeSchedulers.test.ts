import test from "node:test";
import assert from "node:assert/strict";

const { createSchedulers } = require("../app/appRuntime") as {
  createSchedulers: (deps: unknown, services: unknown) => { cronController: unknown; outboxWorker: unknown; outboxEnabled: boolean };
};

interface OutboxWorkerOpts { isPaused: () => Promise<boolean> }

function buildDeps(getOutboxPaused: unknown) {
  let capturedIsPaused: (() => Promise<boolean>) | undefined;
  const deps = {
    mongoose: {}, performance: { now: () => 0 }, crypto: {},
    createCronController: () => ({ scheduleNextCron() { }, runCronCycle: async () => { }, stop() { }, getHealthSnapshot() { return {}; } }),
    createOutboxWorker: (opts: OutboxWorkerOpts) => { capturedIsPaused = opts.isPaused; return { start() { }, stop() { } }; },
    errorMessage: (e: unknown) => String(e), errorDetail: (e: unknown) => String(e),
    commands: { drainOutbox: async () => ({}) },
    mongo: {
      logger: () => { }, env: { PORT: 3000 }, parseEnvNumber: (_n: string, d: number) => d,
      acquireDbLock: async () => "token", renewDbLock: async () => true, releaseDbLock: async () => { },
      adminAlert: async () => { }, requestContext: {}, getOutboxPaused
    }
  };
  const services = { client: {}, metrics: {}, lifecycle: { isShuttingDown: false }, config: {}, games: [] };
  return { deps, services, getCaptured: () => capturedIsPaused };
}

test("createSchedulers cu outbox activ: isPaused e cablat din getOutboxPaused si nu crapa", async () => {
  const prev = process.env.NOTIFICATION_OUTBOX_ENABLED;
  process.env.NOTIFICATION_OUTBOX_ENABLED = "true";
  try {
    const { deps, services, getCaptured } = buildDeps(async () => true);
    const schedulers = createSchedulers(deps, services);
    assert.equal(schedulers.outboxEnabled, true, "NOTIFICATION_OUTBOX_ENABLED=true -> outboxEnabled");
    const isPaused = getCaptured();
    assert.equal(typeof isPaused, "function", "isPaused este cablat in worker");
    const result = await isPaused!();
    assert.equal(result, true, "isPaused deleaga corect la getOutboxPaused (nu crapa)");
  } finally {
    if (prev === undefined) delete process.env.NOTIFICATION_OUTBOX_ENABLED; else process.env.NOTIFICATION_OUTBOX_ENABLED = prev;
  }
});

test("createSchedulers: fara getOutboxPaused in mongo, isPaused() arunca (clasa de bug P0.1 — dep lipsa in main.ts)", async () => {
  const { deps, services, getCaptured } = buildDeps(undefined);
  createSchedulers(deps, services);
  const isPaused = getCaptured();
  assert.equal(typeof isPaused, "function");
  await assert.rejects(async () => isPaused!(), /is not a function|getOutboxPaused/,
    "fara getOutboxPaused cablat, worker-ul ar crapa la verificarea de pauza — exact ce prinde acum satisfies AppRuntimeDeps in main.ts");
});
