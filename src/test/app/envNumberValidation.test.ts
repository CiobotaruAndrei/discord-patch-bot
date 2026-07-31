import attachLogging from "../../shared/logging.js";
import test from "node:test";
import assert from "node:assert/strict";

import { execFileSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const { classifyEnvNumber } = attachLogging;

test("classifyEnvNumber: numar valid in interval -> ok, valoarea parsata", () => {
  const r = classifyEnvNumber("FETCH_CONCURRENCY", "12", 10, { min: 1, max: 50 });
  assert.equal(r.kind, "ok");
  assert.equal(r.value, 12);
});

test("classifyEnvNumber: variabila neset sau goala -> default (nu eroare)", () => {
  assert.deepEqual(classifyEnvNumber("MAX_DEALS", undefined, 50, { min: 1, max: 500 }), { kind: "default", value: 50 });
  assert.deepEqual(classifyEnvNumber("MAX_DEALS", "", 50, { min: 1, max: 500 }), { kind: "default", value: 50 });
});

test("classifyEnvNumber: typo non-numeric -> invalid (NU mai cade tacut pe default), mesajul numeste variabila si intervalul", () => {
  const r = classifyEnvNumber("DISCORD_SEND_RATE_MAX_WAIT_MS", "5oo0", 5000, { min: 1, max: 60000 });
  assert.equal(r.kind, "invalid", "o valoare ne-numerica trebuie semnalata, nu transformata in default");
  assert.match(r.message ?? "", /DISCORD_SEND_RATE_MAX_WAIT_MS/);
  assert.match(r.message ?? "", /5oo0/);
  assert.match(r.message ?? "", /1\.\.60000/);
});

test("classifyEnvNumber: numar valid sub minim -> clamped la minim (ramane defensiv, nu fail-fast)", () => {
  const r = classifyEnvNumber("NOTIFICATION_OUTBOX_DRAIN_LIMIT", "0", 50, { min: 1, max: 1000 });
  assert.equal(r.kind, "clamped");
  assert.equal(r.value, 1);
});

test("classifyEnvNumber: numar valid peste maxim -> clamped la maxim", () => {
  const r = classifyEnvNumber("FETCH_CONCURRENCY", "9999", 10, { min: 1, max: 50 });
  assert.equal(r.kind, "clamped");
  assert.equal(r.value, 50);
});

test("parseEnvNumber: o valoare numerica invalida opreste boot-ul cu process.exit(1)", () => {
  const loggingPath = fileURLToPath(new URL("../../shared/logging.js", import.meta.url));
  const script = [
    `const { AsyncLocalStorage } = await import("node:async_hooks");`,
    `const attach = (await import(${JSON.stringify(pathToFileURL(loggingPath).href)})).default;`,
    `const target = { AsyncLocalStorage };`,
    `attach(target);`,
    `process.env.TEST_KNOB_INVALID = "abc";`,
    `target.parseEnvNumber("TEST_KNOB_INVALID", 5, { min: 1, max: 10 });`,
    `console.log("UNREACHABLE");`
  ].join("\n");

  let exitCode = 0;
  try {
    execFileSync(process.execPath, ["--input-type=module", "-e", script], { stdio: "pipe" });
  } catch (err) {
    exitCode = (err as { status?: number }).status ?? -1;
  }
  assert.equal(exitCode, 1, "parseEnvNumber face process.exit(1) cand o variabila numerica are valoare invalida");
});
