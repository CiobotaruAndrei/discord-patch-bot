import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createLockHeartbeat } from "../../app/scheduler/lockHeartbeat.js";

function baseDeps(overrides: Partial<Parameters<typeof createLockHeartbeat>[0]> = {}) {
  const logs: string[] = [];
  let lostCalls = 0;
  const deps = {
    lockName: "test_lock",
    renewDbLock: async () => true,
    lockTtlMs: 120_000,
    heartbeatIntervalMs: 1000,
    isShuttingDown: () => false,
    logger: (_l: string, _c: string, msg: string) => { logs.push(msg); },
    logContext: "TEST_HEARTBEAT",
    errorMessage: (err: unknown) => err instanceof Error ? err.message : String(err),
    onLost: () => { lostCalls++; },
    ...overrides
  };
  return { deps, logs, lostCount: () => lostCalls };
}

test("heartbeat reinnoieste lock-ul periodic cat timp renew reuseste (fara onLost)", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let renewCalls = 0;
    const { deps, lostCount } = baseDeps({ renewDbLock: async () => { renewCalls++; return true; } });
    const hb = createLockHeartbeat(deps);
    hb.start("tok");
    mock.timers.tick(1000);
    mock.timers.tick(1000);
    assert.ok(renewCalls >= 1, "lock-ul e reinnoit la fiecare interval");
    assert.equal(lostCount(), 0, "cat timp renew reuseste, nu se declanseaza onLost");
    hb.stop();
  } finally {
    mock.timers.reset();
  }
});

test("heartbeat cheama onLost imediat cand renew intoarce false (lock pierdut)", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { deps, lostCount } = baseDeps({ renewDbLock: async () => false });
    const hb = createLockHeartbeat(deps);
    hb.start("tok");
    mock.timers.tick(1000);
    await Promise.resolve();
    assert.equal(lostCount(), 1, "un renew esuat (false) declanseaza onLost -> apelantul abandoneaza");
    hb.stop();
  } finally {
    mock.timers.reset();
  }
});

test("stop opreste heartbeat-ul; un tick de la un token vechi nu mai reinnoieste", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let renewCalls = 0;
    const { deps } = baseDeps({ renewDbLock: async () => { renewCalls++; return true; } });
    const hb = createLockHeartbeat(deps);
    hb.start("tok");
    hb.stop();
    mock.timers.tick(5000);
    assert.equal(renewCalls, 0, "dupa stop, tick-ul nu mai reinnoieste");
  } finally {
    mock.timers.reset();
  }
});
