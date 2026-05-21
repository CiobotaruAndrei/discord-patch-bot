import test from "node:test";
import assert from "node:assert/strict";
import { createCronController } from "../app/scheduler/cron";

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
      env: { GLOBAL_HEALTH_WINDOW: 3, GLOBAL_HEALTH_MIN_RATIO: 50 } as any,
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
