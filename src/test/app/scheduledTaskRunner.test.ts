import test from "node:test";
import assert from "node:assert/strict";
import { createScheduledTaskRunner } from "../../app/scheduler/scheduledTaskRunner.js";

test("scheduled task runner nu suprapune doua executii", async () => {
  let release = (): void => undefined;
  const first = new Promise<void>(resolve => { release = resolve; });
  const runner = createScheduledTaskRunner({ intervalMs: 1000, task: () => first });
  const active = runner.runNow();
  const skipped = await runner.runNow();
  assert.equal(skipped.status, "skipped");
  release();
  assert.equal((await active).status, "completed");
});

test("scheduled task runner raporteaza erorile fara unhandled rejection", async () => {
  const error = new Error("boom");
  const runner = createScheduledTaskRunner({ intervalMs: 1000, task: async () => { throw error; } });
  const result = await runner.runNow();
  assert.equal(result.status, "failed");
  assert.equal(result.error, error);
});

test("scheduled task runner transmite abort la stop", async () => {
  let observed = false;
  const runner = createScheduledTaskRunner({
    intervalMs: 1000,
    task: signal => new Promise<void>(resolve => {
      signal.addEventListener("abort", () => { observed = true; resolve(); }, { once: true });
    })
  });
  const active = runner.runNow();
  await runner.stop();
  await active;
  assert.equal(observed, true);
});

test("scheduled task runner asteapta task-ul activ dupa abort", async () => {
  let release = (): void => undefined;
  let aborted = false;
  const runner = createScheduledTaskRunner({
    intervalMs: 1000,
    task: signal => new Promise<void>(resolve => {
      release = resolve;
      signal.addEventListener("abort", () => { aborted = true; }, { once: true });
    })
  });
  const active = runner.runNow();
  let stopped = false;
  const stopping = runner.stop().then(() => { stopped = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(aborted, true);
  assert.equal(stopped, false);
  release();
  await stopping;
  assert.equal((await active).status, "completed");
});

test("scheduled task runner limiteaza asteptarea la shutdown", async () => {
  const runner = createScheduledTaskRunner({
    intervalMs: 1000,
    shutdownTimeoutMs: 10,
    task: () => new Promise<void>(() => undefined)
  });
  void runner.runNow();
  const startedAt = Date.now();
  await runner.stop();
  assert.ok(Date.now() - startedAt < 500);
});
