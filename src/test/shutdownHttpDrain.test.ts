import test from "node:test";
import assert from "node:assert/strict";
import { createShutdownController } from "../app/lifecycle/shutdown";

function makeBaseDeps() {
  const order: string[] = [];
  return {
    order,
    deps: {
      lifecycle: { isShuttingDown: false },
      logger: (() => undefined) as any,
      env: { SHUTDOWN_DRAIN_MS: 0 } as any,
      client: { destroy: async () => { order.push("client.destroy"); } },
      mongoose: { connection: { close: async () => { order.push("mongo.close"); } } },
      activeLocks: new Map<string, string>(),
      releaseDbLock: async () => undefined,
      cronController: { stop: () => { order.push("cron.stop"); } },
      housekeeping: { stop: () => { order.push("housekeeping.stop"); } },
      adminAlert: async () => undefined,
      errorMessage: (e: unknown) => String(e),
      errorDetail: (e: unknown) => String(e)
    }
  };
}

// Stub setTimeout so the post-shutdown `process.exit(0)` timer never fires
// (the test runner process would otherwise be killed). We intercept ALL
// setTimeout calls inside the test, recording them and giving back a dummy
// handle. Selected timers can still be triggered immediately by the test if
// we want the watchdog path.
function fakeTimers(opts: { fireMs?: number[] } = {}) {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const fired: number[] = [];
  globalThis.setTimeout = ((fn: (...args: unknown[]) => void, ms?: number) => {
    if (opts.fireMs && typeof ms === "number" && opts.fireMs.includes(ms)) {
      Promise.resolve().then(() => { fired.push(ms); fn(); });
    }
    return { unref() {} } as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;
  return {
    get fired() { return fired; },
    restore() {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  };
}

test("shutdown waits for httpServer.close callback before continuing", async () => {
  // V11 regression guard: previously `httpServer.close()` was fired without
  // awaiting the callback, so an in-flight /metrics request could be torn
  // down abruptly when the 500ms post-shutdown setTimeout fired.
  const timers = fakeTimers();
  try {
    const { order, deps } = makeBaseDeps();
    let closeCb: ((err?: Error) => void) | null = null;
    const httpServer = {
      close(cb?: (err?: Error) => void) {
        // Capture the callback but don't invoke it yet — simulates a long
        // request still being served.
        closeCb = cb || null;
        return httpServer;
      }
    };

    const controller = createShutdownController({ ...deps, httpServer });

    // Don't await — we want to check the controller is blocked waiting for the close cb.
    const shutdownPromise = controller.shutdown("SIGTERM");

    // Wait a few event-loop ticks so destroy/close/mongo all start.
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    // Up to here mongo/client should have finished but the HTTP close is still pending.
    assert.ok(order.includes("client.destroy"), "client.destroy should run before HTTP close");
    assert.ok(order.includes("mongo.close"), "mongo.close should run before HTTP close");

    // Now release the close callback — shutdown should finish.
    // V11: TS5 trips TS2349 ("expression not callable") on every variant of
    // `closeCb!()` / `if (!closeCb) throw; closeCb();` / `const x = closeCb`
    // because the variable is a `let` assigned inside a nested closure and
    // strict-mode control flow refuses to narrow past the closure boundary.
    // Cast to the concrete function type at the call site to bypass it —
    // the runtime check above guarantees we don't actually call null.
    if (!closeCb) {
      throw new Error("httpServer.close should have been invoked with a callback");
    }
    (closeCb as (err?: Error) => void)();
    await shutdownPromise;
  } finally {
    timers.restore();
  }
});

test("handleFatalProcessError clears the alert-budget timer once adminAlert wins the race", async () => {
  // V11 regression guard: previously the budget Promise was a free-standing
  // `setTimeout(resolve, 2000)` without unref/clearTimeout. When adminAlert
  // resolved first, Promise.race resolved but the timer kept refing the event
  // loop for up to 2s — blocking a clean natural exit and forcing reliance
  // on the 10s force-exit safety net even on fast shutdowns. Now the timer
  // is unref'd AND cleared from the race's .finally.
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  type Handle = { id: number; ms: number; unrefed: boolean };
  const timers: Handle[] = [];
  let nextId = 1;
  const cleared = new Set<number>();

  globalThis.setTimeout = ((fn: (...args: unknown[]) => void, ms?: number) => {
    const id = nextId++;
    const handle: Handle = { id, ms: typeof ms === "number" ? ms : 0, unrefed: false };
    timers.push(handle);
    // Never actually fire — we just observe scheduling/clearing.
    return {
      __id: id,
      unref() { handle.unrefed = true; }
    } as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((handle: { __id?: number } | undefined) => {
    if (handle && typeof handle.__id === "number") cleared.add(handle.__id);
  }) as typeof clearTimeout;

  try {
    const { deps } = makeBaseDeps();
    const httpServer = {
      close(cb?: (err?: Error) => void) { if (cb) cb(); return httpServer; }
    };
    let adminAlertResolve!: () => void;
    const adminAlertPromise = new Promise<undefined>(resolve => {
      adminAlertResolve = () => resolve(undefined);
    });

    const controller = createShutdownController({
      ...deps,
      httpServer,
      adminAlert: () => adminAlertPromise
    });

    // Don't await — handleFatalProcessError schedules shutdown via .finally(),
    // we need to inspect timer state before/after the race resolves.
    controller.handleFatalProcessError("uncaughtException", new Error("boom"));

    // After scheduling, the budget timer (2000ms) and the force-exit timer
    // (10_000ms) should be registered.
    const budgetTimer = timers.find(t => t.ms === 2000);
    assert.ok(budgetTimer, "budget timer must be scheduled");
    assert.equal(budgetTimer!.unrefed, true, "budget timer must be unref'd so it doesn't keep the loop alive");
    assert.equal(cleared.has(budgetTimer!.id), false, "budget timer not cleared yet — race still pending");

    // Resolve adminAlert; race wins via adminAlert branch.
    adminAlertResolve();
    // Let .finally() handlers run.
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(cleared.has(budgetTimer!.id), true,
      "budget timer must be clearTimeout'd by the race's .finally so it doesn't keep refing the loop");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("shutdown gives up after HTTP_CLOSE_BUDGET if close never fires its callback", async () => {
  // V11: a stuck connection cannot block shutdown forever — the 3-second
  // budget timer is the safety net. We fire it instantly via fakeTimers so
  // the test doesn't actually wait 3 s.
  const timers = fakeTimers({ fireMs: [3000] });
  try {
    const { deps } = makeBaseDeps();
    const httpServer = {
      // Never call the callback — simulates a stuck connection.
      close(_cb?: (err?: Error) => void) { return httpServer; }
    };
    const controller = createShutdownController({ ...deps, httpServer });
    await controller.shutdown("SIGTERM");
    assert.deepEqual(timers.fired, [3000],
      "the HTTP_CLOSE_BUDGET watchdog must fire when close never callbacks");
  } finally {
    timers.restore();
  }
});
