import test from "node:test";
import assert from "node:assert/strict";
import { fakeTimer } from "./fakeTimer";
import { createHousekeeping } from "../app/scheduler/housekeeping";

test("housekeeping start is idempotent", () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const handles: unknown[] = [];
  let cleared = 0;

  globalThis.setInterval = ((handler: (...args: unknown[]) => void, timeout?: number, ...args: unknown[]) => {
    const handle = { handler, timeout, args };
    handles.push(handle);
    return fakeTimer();
  }) as typeof setInterval;
  globalThis.clearInterval = ((handle?: ReturnType<typeof setInterval>) => {
    if (handle) cleared += 1;
  }) as typeof clearInterval;

  try {
    const housekeeping = createHousekeeping({
      commands: { cleanCache() {} },
      cleanGuildCache() {},
      scrapers: { cleanEnrichedCache() {} },
      rateLimiter: { prune() {} },
      logger() {},
      env: { HOUSEKEEPING_INTERVAL_MS: 1000 },
      errorMessage: err => String(err)
    });

    housekeeping.start();
    housekeeping.start();
    assert.equal(handles.length, 1);

    housekeeping.stop();
    assert.equal(cleared, 1);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});
