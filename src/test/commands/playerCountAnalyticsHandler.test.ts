import test from "node:test";
import assert from "node:assert/strict";
import { buildSparkline, calculatePlayerCountStats } from "../../features/command-handlers/playerCountAnalyticsHandler.js";

test("player-count stats calculeaza minim, varf (peak) cu momentul lui, medie, ultima valoare si tendinta (audit, #1)", () => {
  const points = [
    { appId: "10", gameKey: "demo", playerCount: 100, fetchedAt: new Date("2026-01-01T00:00:00Z") },
    { appId: "10", gameKey: "demo", playerCount: 200, fetchedAt: new Date("2026-01-01T01:00:00Z") },
    { appId: "10", gameKey: "demo", playerCount: 150, fetchedAt: new Date("2026-01-01T02:00:00Z") }
  ];
  assert.deepEqual(calculatePlayerCountStats(points), {
    minimum: 100,
    maximum: 200,
    average: 150,
    latest: 150,
    peakAt: new Date("2026-01-01T01:00:00Z"),
    direction: "rising"
  });
  assert.equal(calculatePlayerCountStats(points.slice(0, 1)), null);
});

test("player-count directia: descrescator si stabil (audit, #1)", () => {
  const falling = [
    { appId: "10", gameKey: "demo", playerCount: 500, fetchedAt: new Date("2026-01-01T00:00:00Z") },
    { appId: "10", gameKey: "demo", playerCount: 480, fetchedAt: new Date("2026-01-01T01:00:00Z") },
    { appId: "10", gameKey: "demo", playerCount: 300, fetchedAt: new Date("2026-01-01T02:00:00Z") },
    { appId: "10", gameKey: "demo", playerCount: 280, fetchedAt: new Date("2026-01-01T03:00:00Z") }
  ];
  assert.equal(calculatePlayerCountStats(falling)?.direction, "falling");

  const stable = [
    { appId: "10", gameKey: "demo", playerCount: 1000, fetchedAt: new Date("2026-01-01T00:00:00Z") },
    { appId: "10", gameKey: "demo", playerCount: 1001, fetchedAt: new Date("2026-01-01T01:00:00Z") },
    { appId: "10", gameKey: "demo", playerCount: 999, fetchedAt: new Date("2026-01-01T02:00:00Z") },
    { appId: "10", gameKey: "demo", playerCount: 1000, fetchedAt: new Date("2026-01-01T03:00:00Z") }
  ];
  assert.equal(calculatePlayerCountStats(stable)?.direction, "stable");
});

test("sparkline este marginit si pastreaza directia valorilor", () => {
  const line = buildSparkline([1, 2, 3, 4, 5], 4);
  assert.equal(Array.from(line).length, 4);
  assert.notEqual(Array.from(line)[0], Array.from(line).at(-1));
});
