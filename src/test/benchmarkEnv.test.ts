import test from "node:test";
import assert from "node:assert/strict";

import { strictEnvFloat, strictEnvInt } from "../scripts/benchmarkEnv.js";

const VAR = "BENCH_ENV_TEST_VAR";

function withEnv(value: string | undefined, run: () => void): void {
  const previous = process.env[VAR];
  if (value === undefined) delete process.env[VAR];
  else process.env[VAR] = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env[VAR];
    else process.env[VAR] = previous;
  }
}

test("strictEnvFloat: nesetat sau gol foloseste default-ul", () => {
  withEnv(undefined, () => assert.equal(strictEnvFloat(VAR, 0.85), 0.85));
  withEnv("", () => assert.equal(strictEnvFloat(VAR, 0.85), 0.85));
  withEnv("   ", () => assert.equal(strictEnvFloat(VAR, 0.85), 0.85));
});

test("strictEnvFloat: valoare valida e folosita, inclusiv 0 explicit (nu mai cade pe default ca la `|| fallback`)", () => {
  withEnv("1.4", () => assert.equal(strictEnvFloat(VAR, 0.85), 1.4));
  withEnv("0", () => assert.equal(strictEnvFloat(VAR, 0.85), 0));
});

test("strictEnvFloat: typo / valoare ne-numerica arunca eroare clara (nu mai e fallback tacut)", () => {
  withEnv("abc", () => assert.throws(() => strictEnvFloat(VAR, 0.85), /BENCH_ENV_TEST_VAR="abc".*typo/));
  withEnv("o.5", () => assert.throws(() => strictEnvFloat(VAR, 0.85), /numar finit/));
  withEnv("NaN", () => assert.throws(() => strictEnvFloat(VAR, 0.85), /typo/));
  withEnv("-0.5", () => assert.throws(() => strictEnvFloat(VAR, 0.85), />= 0/));
});

test("strictEnvInt: nesetat foloseste default, valoare intreaga valida e folosita", () => {
  withEnv(undefined, () => assert.equal(strictEnvInt(VAR, 3), 3));
  withEnv("5", () => assert.equal(strictEnvInt(VAR, 3), 5));
});

test("strictEnvInt: non-intreg, sub minim sau typo arunca eroare", () => {
  withEnv("1.5", () => assert.throws(() => strictEnvInt(VAR, 3), /intreg/));
  withEnv("0", () => assert.throws(() => strictEnvInt(VAR, 3), />= 1/));
  withEnv("-2", () => assert.throws(() => strictEnvInt(VAR, 3), />= 1/));
  withEnv("abc", () => assert.throws(() => strictEnvInt(VAR, 3), /typo/));
});
