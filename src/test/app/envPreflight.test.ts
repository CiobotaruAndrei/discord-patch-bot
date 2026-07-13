import test from "node:test";
import assert from "node:assert/strict";

import { evaluateEnvPreflight, REQUIRED_ENV_VARS } from "../../shared/envPreflight.js";

const FULL_ENV = {
  MONGO_URI: "mongodb://localhost:27017/bot",
  DISCORD_TOKEN: "token",
  DISCORD_CLIENT_ID: "123",
  BOT_GLOBAL_ACCESS_CODE_HASH: "abc",
  NODE_ENV: "production",
  REDIS_URL: "redis://localhost:6379"
};

test("evaluateEnvPreflight: variabilele obligatorii sunt exact cele cerute fail-fast la boot de shared/env", () => {
  assert.deepEqual([...REQUIRED_ENV_VARS], ["MONGO_URI", "DISCORD_TOKEN", "DISCORD_CLIENT_ID"]);
  const report = evaluateEnvPreflight(FULL_ENV);
  assert.equal(report.ok, true);
  assert.deepEqual(report.missingRequired, []);
  assert.deepEqual(report.presentRequired, ["MONGO_URI", "DISCORD_TOKEN", "DISCORD_CLIENT_ID"]);
  assert.deepEqual(report.warnings, []);
});

test("evaluateEnvPreflight: lipsa oricarei variabile obligatorii => ok=false, cu numele exact", () => {
  const report = evaluateEnvPreflight({ ...FULL_ENV, DISCORD_TOKEN: undefined, MONGO_URI: "" });
  assert.equal(report.ok, false);
  assert.deepEqual(report.missingRequired, ["MONGO_URI", "DISCORD_TOKEN"]);
  assert.deepEqual(report.presentRequired, ["DISCORD_CLIENT_ID"]);
});

test("evaluateEnvPreflight: codul global in clar fara hash => avertisment care recomanda hash-ul", () => {
  const report = evaluateEnvPreflight({ ...FULL_ENV, BOT_GLOBAL_ACCESS_CODE_HASH: undefined, BOT_GLOBAL_ACCESS_CODE: "secret" });
  assert.equal(report.ok, true, "avertismentele nu blocheaza");
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /BOT_GLOBAL_ACCESS_CODE_HASH/);
});

test("evaluateEnvPreflight: fara cod si fara hash => avertisment ca fallback-ul de cod global e dezactivat", () => {
  const report = evaluateEnvPreflight({ ...FULL_ENV, BOT_GLOBAL_ACCESS_CODE_HASH: undefined });
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /dezactivat/);
});

test("evaluateEnvPreflight: NODE_ENV nesetat => avertisment informativ, nu esec", () => {
  const report = evaluateEnvPreflight({ ...FULL_ENV, NODE_ENV: undefined });
  assert.equal(report.ok, true);
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /NODE_ENV/);
});

test("evaluateEnvPreflight: REDIS_URL nesetat => avertisment ca Redis e dezactivat, dar nu blocheaza boot-ul", () => {
  const report = evaluateEnvPreflight({ ...FULL_ENV, REDIS_URL: undefined });
  assert.equal(report.ok, true, "REDIS_URL lipsa nu opreste boot-ul (Redis e optional)");
  assert.equal(report.warnings.length, 1);
  assert.equal(report.warnings[0], "REDIS_URL nu e setat — Redis/cache extern dezactivat.");
});
