import test from "node:test";
import assert from "node:assert/strict";
import { parseBooleanEnv, BOOLEAN_ENV_PATTERN } from "../shared/booleanEnv.js";

test("parseBooleanEnv: true/1 (case-insensitive, cu spatii) -> true", () => {
  for (const v of ["true", "TRUE", "True", "1", " true ", "  1"]) {
    assert.equal(parseBooleanEnv(v), true, `'${v}' -> true`);
  }
});

test("parseBooleanEnv: false/0/gol/undefined -> false", () => {
  for (const v of ["false", "FALSE", "0", "", "   ", undefined]) {
    assert.equal(parseBooleanEnv(v), false, `'${String(v)}' -> false`);
  }
});

test("parseBooleanEnv: typo (treu/yes) -> false (NU arunca; validarea de schema le respinge la boot)", () => {
  assert.equal(parseBooleanEnv("treu"), false);
  assert.equal(parseBooleanEnv("yes"), false);
});

test("BOOLEAN_ENV_PATTERN: accepta doar true/false/1/0 (case-insensitive), respinge typo-uri", () => {
  for (const ok of ["true", "false", "1", "0", "TRUE", "False"]) {
    assert.match(ok, BOOLEAN_ENV_PATTERN, `'${ok}' este boolean-like valid`);
  }
  for (const bad of ["treu", "yes", "no", "on", "off", "2", "tru", ""]) {
    assert.doesNotMatch(bad, BOOLEAN_ENV_PATTERN, `'${bad}' este respins de validare (typo prins la boot)`);
  }
});
