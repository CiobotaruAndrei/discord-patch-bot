import test from "node:test";
import assert from "node:assert/strict";
import { createOutboxWorker, OUTBOX_DRAIN_LOCK_NAME } from "../app/scheduler/outboxWorker";

interface DrainResult { sent?: number; retried?: number; deadLettered?: number; queued?: number; deliveryMsTotal?: number; oldestJobAgeMs?: number; recoveryDuplicates?: number; recoveryFetches?: number; recoveryFailures?: number; recoveryMarkerMissing?: number }
interface Harness {
  drainCalls: number;
  releaseCalls: Array<{ jobName: string; token: string }>;
  acquireCalls: number;
  lockTtls: number[];
  metrics: {
    outboxSent: number;
    outboxRetried: number;
    outboxDeadLettered: number;
    outboxDrains: number;
    outboxQueueDepth: number;
    outboxDeliveryMsTotal: number;
    outboxOldestJobAgeSeconds: number;
    outboxLockAcquireFailures: number;
    outboxRecoveryDuplicates: number;
    outboxRecoveryFetches: number;
    outboxRecoveryFailures: number;
    outboxRecoveryMarkerMissing: number;
  };
}

function makeWorker(overrides: {
  lockToken?: string | null;
  readyState?: number;
  clientReady?: boolean;
  shuttingDown?: boolean;
  drainThrows?: boolean;
  drainResult?: DrainResult;
  drainLimit?: number;
  perJobBudgetMs?: number;
} = {}) {
  const harness: Harness = {
    drainCalls: 0,
    releaseCalls: [],
    acquireCalls: 0,
    lockTtls: [],
    metrics: {
      outboxSent: 0, outboxRetried: 0, outboxDeadLettered: 0, outboxDrains: 0, outboxQueueDepth: 0,
      outboxDeliveryMsTotal: 0, outboxOldestJobAgeSeconds: 0, outboxLockAcquireFailures: 0,
      outboxRecoveryDuplicates: 0, outboxRecoveryFetches: 0, outboxRecoveryFailures: 0, outboxRecoveryMarkerMissing: 0
    }
  };
  const lifecycle = { isShuttingDown: overrides.shuttingDown ?? false };
  const worker = createOutboxWorker({
    mongoose: { connection: { readyState: overrides.readyState ?? 1 } },
    client: { isReady: () => overrides.clientReady ?? true },
    logger: () => undefined,
    parseEnvNumber: (_name: string, def: number) => def,
    acquireDbLock: async (jobName: string, ttlMs: number) => {
      harness.acquireCalls++;
      harness.lockTtls.push(ttlMs);
      assert.equal(jobName, OUTBOX_DRAIN_LOCK_NAME, "worker-ul foloseste lock-ul dedicat outbox_drain");
      return overrides.lockToken === undefined ? "lock-token" : overrides.lockToken;
    },
    releaseDbLock: async (jobName: string, token: string) => {
      harness.releaseCalls.push({ jobName, token });
    },
    drainOutbox: async () => {
      harness.drainCalls++;
      if (overrides.drainThrows) throw new Error("drain boom");
      return overrides.drainResult ?? { sent: 0, retried: 0, deadLettered: 0, queued: 0 };
    },
    lifecycle,
    metrics: harness.metrics,
    errorMessage: (err: unknown) => err instanceof Error ? err.message : String(err),
    drainLimit: overrides.drainLimit ?? 50,
    perJobBudgetMs: overrides.perJobBudgetMs ?? 7000
  });
  return { worker, harness, lifecycle };
}

test("outboxWorker: drainTick drenza sub lock si elibereaza lock-ul", async () => {
  const { worker, harness } = makeWorker();
  await worker.drainTick();
  assert.equal(harness.acquireCalls, 1);
  assert.equal(harness.drainCalls, 1, "drain apelat o data cand lock-ul e obtinut");
  assert.equal(harness.releaseCalls.length, 1, "lock-ul este eliberat dupa drain");
  assert.deepEqual(harness.releaseCalls[0], { jobName: OUTBOX_DRAIN_LOCK_NAME, token: "lock-token" });
  worker.stop();
});

test("outboxWorker: lock detinut de alta instanta -> nu drenza, nu elibereaza", async () => {
  const { worker, harness } = makeWorker({ lockToken: null });
  await worker.drainTick();
  assert.equal(harness.acquireCalls, 1);
  assert.equal(harness.drainCalls, 0, "fara lock nu se drenza");
  assert.equal(harness.releaseCalls.length, 0, "nimic de eliberat daca lock-ul nu a fost obtinut");
  worker.stop();
});

test("outboxWorker: Mongo neconectat -> sare drenarea fara sa atinga lock-ul", async () => {
  const { worker, harness } = makeWorker({ readyState: 0 });
  await worker.drainTick();
  assert.equal(harness.acquireCalls, 0, "nu incearca lock daca Mongo nu e conectat");
  assert.equal(harness.drainCalls, 0);
  worker.stop();
});

test("outboxWorker: client Discord not ready -> sare drenarea", async () => {
  const { worker, harness } = makeWorker({ clientReady: false });
  await worker.drainTick();
  assert.equal(harness.acquireCalls, 0);
  assert.equal(harness.drainCalls, 0);
  worker.stop();
});

test("outboxWorker: in shutdown drainTick iese imediat", async () => {
  const { worker, harness } = makeWorker({ shuttingDown: true });
  await worker.drainTick();
  assert.equal(harness.acquireCalls, 0);
  assert.equal(harness.drainCalls, 0);
  worker.stop();
});

test("outboxWorker: eroarea de drain este prinsa si lock-ul tot se elibereaza", async () => {
  const { worker, harness } = makeWorker({ drainThrows: true });
  await worker.drainTick();
  assert.equal(harness.drainCalls, 1);
  assert.equal(harness.releaseCalls.length, 1, "lock eliberat chiar daca drain arunca");
  worker.stop();
});

test("outboxWorker: actualizeaza metrics din rezultatul drenarii (countere + latenta + vechime)", async () => {
  const { worker, harness } = makeWorker({ drainResult: { sent: 3, retried: 1, deadLettered: 2, queued: 7, deliveryMsTotal: 1200, oldestJobAgeMs: 45_000, recoveryDuplicates: 2, recoveryFetches: 5, recoveryFailures: 1, recoveryMarkerMissing: 3 } });
  await worker.drainTick();
  assert.equal(harness.metrics.outboxDrains, 1, "numara ciclul de drenare");
  assert.equal(harness.metrics.outboxSent, 3);
  assert.equal(harness.metrics.outboxRetried, 1);
  assert.equal(harness.metrics.outboxDeadLettered, 2);
  assert.equal(harness.metrics.outboxQueueDepth, 7, "queue depth este un gauge setat la valoarea curenta");
  assert.equal(harness.metrics.outboxDeliveryMsTotal, 1200, "latenta cumulata de livrare");
  assert.equal(harness.metrics.outboxOldestJobAgeSeconds, 45, "vechimea celui mai vechi job in secunde");
  assert.equal(harness.metrics.outboxRecoveryDuplicates, 2, "duplicate prevenite la recovery");
  assert.equal(harness.metrics.outboxRecoveryFetches, 5, "fetch-uri istoric la recovery");
  assert.equal(harness.metrics.outboxRecoveryFailures, 1, "esecuri de verificare la recovery");
  assert.equal(harness.metrics.outboxRecoveryMarkerMissing, 3, "fetch reusit dar marker negasit -> re-trimis");
  worker.stop();
});

test("outboxWorker: lock detinut de alta instanta incrementeaza outboxLockAcquireFailures", async () => {
  const { worker, harness } = makeWorker({ lockToken: null });
  await worker.drainTick();
  assert.equal(harness.metrics.outboxLockAcquireFailures, 1, "esecul de lock e numarat");
  assert.equal(harness.drainCalls, 0);
  worker.stop();
});

test("outboxWorker: TTL-ul lock-ului se dimensioneaza din drainLimit (scalare cu volumul)", async () => {
  const small = makeWorker({ drainLimit: 50, perJobBudgetMs: 7000 });
  await small.worker.drainTick();
  small.worker.stop();
  const big = makeWorker({ drainLimit: 500, perJobBudgetMs: 7000 });
  await big.worker.drainTick();
  big.worker.stop();
  assert.equal(small.harness.lockTtls[0], 350_000, "50 * 7000 = 350000ms");
  assert.equal(big.harness.lockTtls[0], 3_500_000, "500 * 7000 = 3.5M, sub plafonul de 1h");
  assert.ok(big.harness.lockTtls[0] > small.harness.lockTtls[0], "TTL creste cu drainLimit");
});
