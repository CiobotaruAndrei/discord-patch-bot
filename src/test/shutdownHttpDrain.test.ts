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
  const timers = fakeTimers();
  try {
    const { order, deps } = makeBaseDeps();
    let closeCb: ((err?: Error) => void) | null = null;
    const httpServer = {
      close(cb?: (err?: Error) => void) {

        closeCb = cb || null;
        return httpServer;
      }
    };

    const controller = createShutdownController({ ...deps, httpServer });

    const shutdownPromise = controller.shutdown("SIGTERM");

    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    assert.ok(order.includes("client.destroy"), "client.destroy should run before HTTP close");
    assert.ok(order.includes("mongo.close"), "mongo.close should run before HTTP close");

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

    controller.handleFatalProcessError("uncaughtException", new Error("boom"));

    const budgetTimer = timers.find(t => t.ms === 2000);
    assert.ok(budgetTimer, "budget timer must be scheduled");
    assert.equal(budgetTimer!.unrefed, true, "budget timer must be unref'd so it doesn't keep the loop alive");
    assert.equal(cleared.has(budgetTimer!.id), false, "budget timer not cleared yet — race still pending");

    adminAlertResolve();

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
  const timers = fakeTimers({ fireMs: [3000] });
  try {
    const { deps } = makeBaseDeps();
    const httpServer = {

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
