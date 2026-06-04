import test from "node:test";
import assert from "node:assert/strict";
import { createOutboxWorker } from "../app/scheduler/outboxWorker";

const attachSystemState = require("../infra/mongo/systemState") as (t: Record<string, unknown>) => void;
const { createSchedulers } = require("../app/appRuntime") as {
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
  attachSystemState(target);
  return {
    getOutboxPaused: target.getOutboxPaused as () => Promise<boolean>,
    setOutboxPaused: target.setOutboxPaused as (p: boolean) => Promise<void>
  };
}

function zeroMetrics() {
  return {
    outboxSent: 0, outboxRetried: 0, outboxDeadLettered: 0, outboxDrains: 0, outboxQueueDepth: 0,
    outboxDeliveryMsTotal: 0, outboxOldestJobAgeSeconds: 0, outboxLockAcquireFailures: 0,
    outboxRecoveryDuplicates: 0, outboxRecoveryFetches: 0, outboxRecoveryFailures: 0, outboxRecoveryMarkerMissing: 0,
    outboxMarkSentFailures: 0, outboxRecoveryVerifyEnabledGuilds: 0, outboxLastDrainAt: 0
  };
}

test("P2.3: flux pause/resume end-to-end — starea persistata controleaza drenarea worker-ului real", async () => {
  const { getOutboxPaused, setOutboxPaused } = realState();
  let drainCalls = 0;
  const worker = createOutboxWorker({
    mongoose: { connection: { readyState: 1 } },
    client: { isReady: () => true },
    logger: () => undefined,
    parseEnvNumber: (_n: string, d: number) => d,
    acquireDbLock: async () => "lock-token",
    releaseDbLock: async () => undefined,
    drainOutbox: async () => { drainCalls++; return { sent: 0, retried: 0, deadLettered: 0, queued: 0 }; },
    lifecycle: { isShuttingDown: false },
    metrics: zeroMetrics(),
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
    mongoose: {}, performance: { now: () => 0 }, crypto: {},
    createCronController: () => ({ scheduleNextCron() { }, runCronCycle: async () => { }, stop() { }, getHealthSnapshot() { return {}; } }),
    createOutboxWorker: (opts: { isPaused: () => Promise<boolean> }) => { capturedIsPaused = opts.isPaused; return { start() { }, stop() { } }; },
    errorMessage: (e: unknown) => String(e), errorDetail: (e: unknown) => String(e),
    commands: { drainOutbox: async () => ({}) },
    mongo: {
      logger: () => { }, env: { PORT: 3000 }, parseEnvNumber: (_n: string, d: number) => d,
      acquireDbLock: async () => "token", renewDbLock: async () => true, releaseDbLock: async () => { },
      adminAlert: async () => { }, requestContext: {}, getOutboxPaused
    }
  };
  const services = { client: {}, metrics: {}, lifecycle: { isShuttingDown: false }, config: {}, games: [] };

  const prev = process.env.NOTIFICATION_OUTBOX_ENABLED;
  process.env.NOTIFICATION_OUTBOX_ENABLED = "true";
  try {
    const schedulers = createSchedulers(deps, services);
    assert.equal(schedulers.outboxEnabled, true, "flag-ul activeaza outbox-ul");
    assert.equal(typeof capturedIsPaused, "function", "isPaused cablat in worker");
    assert.equal(await capturedIsPaused!(), false, "initial nu e pe pauza");
    await setOutboxPaused(true);
    assert.equal(await capturedIsPaused!(), true, "isPaused reflecta /outbox pause prin getOutboxPaused-ul real");
  } finally {
    if (prev === undefined) delete process.env.NOTIFICATION_OUTBOX_ENABLED; else process.env.NOTIFICATION_OUTBOX_ENABLED = prev;
  }
});
