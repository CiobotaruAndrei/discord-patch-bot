import test from "node:test";
import assert from "node:assert/strict";
import { createOutboxWorker, OUTBOX_DRAIN_LOCK_NAME } from "../app/scheduler/outboxWorker";

interface Harness {
  drainCalls: number;
  releaseCalls: Array<{ jobName: string; token: string }>;
  acquireCalls: number;
}

function makeWorker(overrides: {
  lockToken?: string | null;
  readyState?: number;
  clientReady?: boolean;
  shuttingDown?: boolean;
  drainThrows?: boolean;
} = {}) {
  const harness: Harness = { drainCalls: 0, releaseCalls: [], acquireCalls: 0 };
  const lifecycle = { isShuttingDown: overrides.shuttingDown ?? false };
  const worker = createOutboxWorker({
    mongoose: { connection: { readyState: overrides.readyState ?? 1 } },
    client: { isReady: () => overrides.clientReady ?? true },
    logger: () => undefined,
    parseEnvNumber: (_name: string, def: number) => def,
    acquireDbLock: async (jobName: string) => {
      harness.acquireCalls++;
      assert.equal(jobName, OUTBOX_DRAIN_LOCK_NAME, "worker-ul foloseste lock-ul dedicat outbox_drain");
      return overrides.lockToken === undefined ? "lock-token" : overrides.lockToken;
    },
    releaseDbLock: async (jobName: string, token: string) => {
      harness.releaseCalls.push({ jobName, token });
    },
    drainOutbox: async () => {
      harness.drainCalls++;
      if (overrides.drainThrows) throw new Error("drain boom");
    },
    lifecycle,
    errorMessage: (err: unknown) => err instanceof Error ? err.message : String(err)
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
