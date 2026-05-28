import test from "node:test";
import assert from "node:assert/strict";
import { createCronController } from "../app/scheduler/cron";
import type { RuntimeEnv } from "../types";

test("cron stop clears the scheduled timer handle", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const handles: unknown[] = [];
  let cleared = 0;

  globalThis.setTimeout = ((handler: (...args: unknown[]) => void, timeout?: number, ...args: unknown[]) => {
    const handle = { handler, timeout, args, unref() {} };
    handles.push(handle);
    return handle as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((handle?: ReturnType<typeof setTimeout>) => {
    if (handle) cleared += 1;
  }) as typeof clearTimeout;

  try {
    const controller = createCronController({
      mongoose: { connection: { readyState: 1 } },
      performance: { now: () => 0 },
      crypto: { randomBytes: () => ({ toString: () => "abc123" }) },
      logger() {},
      env: { GLOBAL_HEALTH_WINDOW: 3, GLOBAL_HEALTH_MIN_RATIO: 50 } as RuntimeEnv,
      parseEnvNumber: (_name, defaultValue) => defaultValue,
      acquireDbLock: async () => null,
      renewDbLock: async () => true,
      releaseDbLock: async () => undefined,
      commands: {
        setGlobalCacheTtl() {},
        checkForUpdates: async () => undefined,
        checkForDiscounts: async () => undefined
      },
      adminAlert: async () => undefined,
      client: { isReady: () => true },
      games: [],
      config: { games: [], checkIntervalMinutes: 30 },
      metrics: {
        fetchSuccess: 0,
        fetchFail: 0,
        httpRetries: 0,
        rateLimitHits: 0,
        cronRuns: 0,
        cronErrors: 0,
        cronSkippedDueToLock: 0,
        cronSkippedDueToHealth: 0,
        cronAborted: 0,
        httpRateLimitDrops: 0,
        startedAt: 0
      },
      lifecycle: { isShuttingDown: false },
      errorMessage: err => String(err),
      errorDetail: err => String(err),
      requestContext: { run: async (_store, callback) => callback() }
    });

    controller.scheduleNextCron();
    assert.equal(handles.length, 1);

    controller.stop();
    controller.stop();
    assert.equal(cleared, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("cron cycle waits for both jobs when one rejects (Promise.allSettled)", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((handler: (...args: unknown[]) => void, _timeout?: number) => {
    return { handler, unref() {} } as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;

  try {
    let discountsResolved = false;
    let lockReleasedAt: number | null = null;
    let discountsFinishedAt: number | null = null;
    const adminAlertCalls: Array<{ kind: string; title: string; body: string }> = [];
    const loggedErrors: Array<{ message: string; meta: unknown }> = [];
    const metrics = {
      fetchSuccess: 0, fetchFail: 0, httpRetries: 0, rateLimitHits: 0,
      cronRuns: 0, cronErrors: 0, cronSkippedDueToLock: 0, cronSkippedDueToHealth: 0,
      cronAborted: 0, httpRateLimitDrops: 0, startedAt: 0
    };

    const controller = createCronController({
      mongoose: { connection: { readyState: 1 } },
      performance: { now: () => Date.now() },
      crypto: { randomBytes: () => ({ toString: () => "deadbe" }) },
      logger(level: string, _logContext: string, message: string, meta?: unknown) {
        if (level === "ERROR") loggedErrors.push({ message, meta });
      },
      env: { GLOBAL_HEALTH_WINDOW: 3, GLOBAL_HEALTH_MIN_RATIO: 50 } as RuntimeEnv,
      parseEnvNumber: (_name: string, defaultValue: number) => defaultValue,
      acquireDbLock: async () => "token-abc",
      renewDbLock: async () => true,
      releaseDbLock: async () => { lockReleasedAt = Date.now(); return undefined; },
      commands: {
        setGlobalCacheTtl() {},
        checkForUpdates: async () => { throw new Error("boom-updates"); },
        checkForDiscounts: async () => {
          await new Promise(resolve => setImmediate(resolve));
          discountsResolved = true;
          discountsFinishedAt = Date.now();
        }
      },
      adminAlert: async (kind: string, title: string, body: string) => {
        adminAlertCalls.push({ kind, title, body });
      },
      client: { isReady: () => true },
      games: [],
      config: { games: [], checkIntervalMinutes: 30 },
      metrics,
      lifecycle: { isShuttingDown: false },
      errorMessage: (err: unknown) => (err as Error)?.message ?? String(err),
      errorDetail: (err: unknown) => (err as Error)?.message ?? String(err),
      requestContext: { run: async (_store, callback) => callback() }
    });

    await controller.runCronCycle();

    assert.equal(discountsResolved, true, "discounts job must finish before the cycle returns");
    assert.notEqual(lockReleasedAt, null);
    assert.notEqual(discountsFinishedAt, null);
    assert.ok(lockReleasedAt! >= discountsFinishedAt!,
      "lock must be released AFTER both jobs finish, not while discounts is still running");
    assert.equal(metrics.cronErrors, 1, "one cycle-level error counted regardless of how many jobs failed");
    assert.equal(metrics.cronAborted, 0);
    assert.equal(adminAlertCalls.length, 1, "single combined admin alert");
    assert.match(adminAlertCalls[0].body, /checkForUpdates: boom-updates/);
    assert.ok(loggedErrors.some(e => /checkForUpdates/.test(e.message)));
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("cron heartbeat tolerates one transient renew throw but aborts on the second", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduledHandlers: Array<() => unknown> = [];

  globalThis.setTimeout = ((handler: () => unknown) => {
    const entry = { handler, unref() {} };
    scheduledHandlers.push(handler);
    return entry as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;

  try {
    let renewCallCount = 0;
    const metrics = {
      fetchSuccess: 0, fetchFail: 0, httpRetries: 0, rateLimitHits: 0,
      cronRuns: 0, cronErrors: 0, cronSkippedDueToLock: 0, cronSkippedDueToHealth: 0,
      cronAborted: 0, httpRateLimitDrops: 0, startedAt: 0
    };

    const controller = createCronController({
      mongoose: { connection: { readyState: 1 } },
      performance: { now: () => Date.now() },
      crypto: { randomBytes: () => ({ toString: () => "ff00aa" }) },
      logger() {},
      env: { GLOBAL_HEALTH_WINDOW: 3, GLOBAL_HEALTH_MIN_RATIO: 50 } as RuntimeEnv,
      parseEnvNumber: (_name: string, defaultValue: number) => defaultValue,
      acquireDbLock: async () => "tok-heartbeat",
      renewDbLock: async () => {
        renewCallCount++;
        throw new Error("mongo blip");
      },
      releaseDbLock: async () => undefined,
      commands: {
        setGlobalCacheTtl() {},

        checkForUpdates: async () => {

          for (let i = 0; i < 50 && renewCallCount < 2; i++) {
            await new Promise(resolve => setImmediate(resolve));
            const next = scheduledHandlers.shift();
            if (next) await next();
          }
        },
        checkForDiscounts: async () => undefined
      },
      adminAlert: async () => undefined,
      client: { isReady: () => true },
      games: [],
      config: { games: [], checkIntervalMinutes: 30 },
      metrics,
      lifecycle: { isShuttingDown: false },
      errorMessage: (err: unknown) => (err as Error)?.message ?? String(err),
      errorDetail: (err: unknown) => (err as Error)?.message ?? String(err),
      requestContext: { run: async (_store, callback) => callback() }
    });

    await controller.runCronCycle();

    assert.equal(renewCallCount, 2,
      `heartbeat must tolerate the first throw and only abort on the second (got ${renewCallCount} attempts)`);
    assert.equal(metrics.cronAborted, 1,
      "the cycle must finish in the aborted bucket once consecutive heartbeat failures fire abort()");
    assert.equal(metrics.cronErrors, 0,
      "transient heartbeat failures must not be counted as cycle-level errors");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("cron heartbeat aborts immediately when renew returns false (lock genuinely lost)", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduledHandlers: Array<() => unknown> = [];

  globalThis.setTimeout = ((handler: () => unknown) => {
    const entry = { handler, unref() {} };
    scheduledHandlers.push(handler);
    return entry as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;

  try {
    let renewCallCount = 0;
    const metrics = {
      fetchSuccess: 0, fetchFail: 0, httpRetries: 0, rateLimitHits: 0,
      cronRuns: 0, cronErrors: 0, cronSkippedDueToLock: 0, cronSkippedDueToHealth: 0,
      cronAborted: 0, httpRateLimitDrops: 0, startedAt: 0
    };

    const controller = createCronController({
      mongoose: { connection: { readyState: 1 } },
      performance: { now: () => Date.now() },
      crypto: { randomBytes: () => ({ toString: () => "ff00bb" }) },
      logger() {},
      env: { GLOBAL_HEALTH_WINDOW: 3, GLOBAL_HEALTH_MIN_RATIO: 50 } as RuntimeEnv,
      parseEnvNumber: (_name: string, defaultValue: number) => defaultValue,
      acquireDbLock: async () => "tok-lost",
      renewDbLock: async () => {
        renewCallCount++;
        return false;
      },
      releaseDbLock: async () => undefined,
      commands: {
        setGlobalCacheTtl() {},
        checkForUpdates: async () => {
          for (let i = 0; i < 50 && renewCallCount < 1; i++) {
            await new Promise(resolve => setImmediate(resolve));
            const next = scheduledHandlers.shift();
            if (next) await next();
          }
        },
        checkForDiscounts: async () => undefined
      },
      adminAlert: async () => undefined,
      client: { isReady: () => true },
      games: [],
      config: { games: [], checkIntervalMinutes: 30 },
      metrics,
      lifecycle: { isShuttingDown: false },
      errorMessage: (err: unknown) => (err as Error)?.message ?? String(err),
      errorDetail: (err: unknown) => (err as Error)?.message ?? String(err),
      requestContext: { run: async (_store, callback) => callback() }
    });

    await controller.runCronCycle();

    assert.equal(renewCallCount, 1,
      "heartbeat must abort after a single `false` return (lock lost)");
    assert.equal(metrics.cronAborted, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("V12: heartbeat tick care se reia in fereastra de release NU mai renew-uie lock-ul", async () => {

  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduledHandlers: Array<() => unknown> = [];
  globalThis.setTimeout = ((handler: () => unknown) => {
    const entry = { handler, unref() {} };
    scheduledHandlers.push(handler);
    return entry as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;

  try {
    let renewTotal = 0;
    const metrics = {
      fetchSuccess: 0, fetchFail: 0, httpRetries: 0, rateLimitHits: 0,
      cronRuns: 0, cronErrors: 0, cronSkippedDueToLock: 0, cronSkippedDueToHealth: 0,
      cronAborted: 0, httpRateLimitDrops: 0, startedAt: 0
    };

    const controller = createCronController({
      mongoose: { connection: { readyState: 1 } },
      performance: { now: () => Date.now() },
      crypto: { randomBytes: () => ({ toString: () => "ff00aa" }) },
      logger() {},
      env: { GLOBAL_HEALTH_WINDOW: 3, GLOBAL_HEALTH_MIN_RATIO: 50 } as RuntimeEnv,
      parseEnvNumber: (_name: string, defaultValue: number) => defaultValue,
      acquireDbLock: async () => "tok-release-race",
      renewDbLock: async () => { renewTotal++; return true; },
      releaseDbLock: async () => {

        const pendingTick = scheduledHandlers.shift();
        if (pendingTick) await pendingTick();
        return undefined;
      },
      commands: {
        setGlobalCacheTtl() {},
        checkForUpdates: async () => undefined,
        checkForDiscounts: async () => undefined
      },
      adminAlert: async () => undefined,
      client: { isReady: () => true },
      games: [],
      config: { games: [], checkIntervalMinutes: 30 },
      metrics,
      lifecycle: { isShuttingDown: false },
      errorMessage: (err: unknown) => (err as Error)?.message ?? String(err),
      errorDetail: (err: unknown) => (err as Error)?.message ?? String(err),
      requestContext: { run: async (_store, callback) => callback() }
    });

    await controller.runCronCycle();

    assert.equal(renewTotal, 0,
      `heartbeat-ul reluat in fereastra de release NU trebuie sa renew-uie (token deja null); got ${renewTotal}`);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
