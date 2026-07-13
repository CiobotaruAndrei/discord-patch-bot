import test from "node:test";
import assert from "node:assert/strict";

import type { BotConfig, RuntimeEnv } from "../../types.js";
import { createCronHealthWindow } from "../../app/scheduler/cronHealthWindow.js";
import { resolveCronScheduleConfig } from "../../app/scheduler/cronScheduleConfig.js";
import { buildCronCycleJobs, runCronJobs, type CronCommandsForJobs } from "../../app/scheduler/cronJobRunner.js";

function makeEnv(overrides: Partial<RuntimeEnv> = {}): RuntimeEnv {
  return { GLOBAL_HEALTH_WINDOW: 5, GLOBAL_HEALTH_MIN_RATIO: 40, ...overrides } as RuntimeEnv;
}

test("cronHealthWindow: sub prag programeaza un skip de backoff o singura data, apoi reia", () => {
  const health = createCronHealthWindow(makeEnv(), () => {});
  for (let i = 0; i < 5; i++) health.recordHealth(false, 100);
  assert.equal(health.shouldSkipForGlobalHealth(), true, "sub 40% -> skip programat");
  assert.equal(health.shouldSkipForGlobalHealth(), false, "urmatoarea verificare reseteaza fereastra si nu mai skip-uieste");
});

test("cronHealthWindow: peste prag nu skip-uieste si snapshot-ul raporteaza ratio + durata medie", () => {
  const health = createCronHealthWindow(makeEnv(), () => {});
  for (let i = 0; i < 5; i++) health.recordHealth(true, 200);
  assert.equal(health.shouldSkipForGlobalHealth(), false);
  const snap = health.getHealthSnapshot();
  assert.equal(snap.successRatio, 100);
  assert.equal(snap.windowSize, 5);
  assert.equal(snap.avgDurationMs, 200);
});

test("cronHealthWindow: fereastra e marginita la GLOBAL_HEALTH_WINDOW", () => {
  const health = createCronHealthWindow(makeEnv({ GLOBAL_HEALTH_WINDOW: 3 } as Partial<RuntimeEnv>), () => {});
  for (let i = 0; i < 10; i++) health.recordHealth(true, 50);
  assert.equal(health.getHealthSnapshot().windowSize, 3);
});

test("resolveCronScheduleConfig: interval nesuportat cade pe default-ul din config si avertizeaza", () => {
  const warns: string[] = [];
  const config: BotConfig = { checkIntervalMinutes: 15, games: [] };
  const parseEnvNumber = (name: string, def: number) => (name === "CRON_INTERVAL_MS" ? 17 * 60 * 1000 : def);
  const cfg = resolveCronScheduleConfig(config, makeEnv(), parseEnvNumber, (level, _c, msg) => { if (level === "WARN") warns.push(msg); });
  assert.equal(cfg.cronIntervalMs, 15 * 60 * 1000, "cade pe intervalul din config (15 min)");
  assert.ok(cfg.lockTtlMs >= cfg.cronIntervalMs + 60_000);
  assert.ok(cfg.heartbeatIntervalMs >= 15_000);
  assert.ok(warns.some(w => w.includes("nu este intr-o valoare suportata")));
});

function makeCommands(calls: string[]): CronCommandsForJobs {
  return {
    checkForUpdates: async () => { calls.push("updates"); },
    checkForDiscounts: async () => { calls.push("discounts"); },
    checkForYouTube: async () => { calls.push("youtube"); },
    refreshPlayerCountSnapshots: async () => { calls.push("playercount"); }
  };
}

test("buildCronCycleJobs: shedDiscounts omite jobul de reduceri, restul raman", async () => {
  const calls: string[] = [];
  const jobs = buildCronCycleJobs(makeCommands(calls), {}, [], true, () => false);
  await Promise.all(jobs.map(j => j.run));
  assert.deepEqual(calls.sort(), ["playercount", "updates", "youtube"]);
  assert.ok(!jobs.some(j => j.label === "checkForDiscounts"));
});

test("buildCronCycleJobs: fara shed include reducerile; omite player-count daca lipseste", async () => {
  const calls: string[] = [];
  const commands = makeCommands(calls);
  delete commands.refreshPlayerCountSnapshots;
  const jobs = buildCronCycleJobs(commands, {}, [], false, () => false);
  await Promise.all(jobs.map(j => j.run));
  assert.deepEqual(calls.sort(), ["discounts", "updates", "youtube"]);
});

test("runCronJobs: intoarce doar joburile care au aruncat, cu labelul lor", async () => {
  const failures = await runCronJobs([
    { label: "ok", run: Promise.resolve(1) },
    { label: "boom", run: Promise.reject(new Error("x")) }
  ]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].label, "boom");
});
