import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import os from "os";
import path from "path";

import { buildSmokeResult, writeSmokeResult } from "../scripts/smokeResult.js";

test("buildSmokeResult: ok=true doar daca toate verificarile trec", () => {
  const now = new Date("2026-01-02T03:04:05.000Z");
  const result = buildSmokeResult("http", false, [
    { name: "healthz", ok: true },
    { name: "metrics", ok: true }
  ], now);
  assert.equal(result.kind, "http");
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.timestamp, "2026-01-02T03:04:05.000Z");
  assert.equal(result.checks.length, 2);
});

test("buildSmokeResult: o verificare esuata face ok=false", () => {
  const result = buildSmokeResult("http", false, [
    { name: "healthz", ok: true },
    { name: "metrics", ok: false, detail: "metrici lipsa" }
  ]);
  assert.equal(result.ok, false);
});

test("buildSmokeResult: skipped=true forteaza ok=true chiar fara verificari", () => {
  const result = buildSmokeResult("discord", true, []);
  assert.equal(result.skipped, true);
  assert.equal(result.ok, true);
  assert.deepEqual(result.checks, []);
});

test("writeSmokeResult: scrie JSON-ul cand env var indica un fisier", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-result-"));
  const file = path.join(dir, "result.json");
  const envVar = "SMOKE_RESULT_TEST_FILE";
  const prev = process.env[envVar];
  process.env[envVar] = file;
  try {
    const result = buildSmokeResult("http", false, [{ name: "healthz", ok: true }]);
    writeSmokeResult(envVar, result);
    assert.ok(fs.existsSync(file), "fisierul de rezultat a fost scris");
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(parsed.kind, "http");
    assert.equal(parsed.ok, true);
    assert.equal(parsed.checks[0].name, "healthz");
  } finally {
    if (prev === undefined) delete process.env[envVar]; else process.env[envVar] = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("writeSmokeResult: nu face nimic cand env var lipseste", () => {
  const envVar = "SMOKE_RESULT_TEST_MISSING";
  const prev = process.env[envVar];
  delete process.env[envVar];
  try {
    assert.doesNotThrow(() => writeSmokeResult(envVar, buildSmokeResult("http", true, [])));
  } finally {
    if (prev !== undefined) process.env[envVar] = prev;
  }
});
