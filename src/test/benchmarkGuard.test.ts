import test from "node:test";
import assert from "node:assert/strict";

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");

import { evaluateBenchmarkGuard, defaultGuardConfig, HOT_PATH_AREAS } from "../scripts/benchmarkGuard";
import type { GuardSample, GuardConfig } from "../scripts/benchmarkGuard";

const CONFIG: GuardConfig = { failBelow: 0.85, warnBelow: { levenshtein: 1.4, dealHash: 1.2 } };

function sample(overrides: Partial<GuardSample>): GuardSample {
  return { area: "levenshtein", rustAvailable: true, speedup: 1.9, parityOk: true, ...overrides };
}

test("evaluateBenchmarkGuard: Rust peste pragul asteptat -> fara esecuri/avertismente", () => {
  const out = evaluateBenchmarkGuard([
    sample({ area: "levenshtein", speedup: 1.9 }),
    sample({ area: "dealHash", speedup: 1.5 })
  ], CONFIG);
  assert.deepEqual(out.failures, []);
  assert.deepEqual(out.warnings, []);
  assert.deepEqual(out.skipped, []);
});

test("evaluateBenchmarkGuard: sub pragul asteptat dar inca mai rapid -> avertisment, fara esec", () => {
  const out = evaluateBenchmarkGuard([
    sample({ area: "levenshtein", speedup: 1.2 })
  ], CONFIG);
  assert.equal(out.failures.length, 0);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /levenshtein/);
  assert.match(out.warnings[0], /sub pragul asteptat/);
});

test("evaluateBenchmarkGuard: Rust mai lent decat TS sub pragul de esec -> esec", () => {
  const out = evaluateBenchmarkGuard([
    sample({ area: "dealHash", speedup: 0.7 })
  ], CONFIG);
  assert.equal(out.failures.length, 1);
  assert.match(out.failures[0], /dealHash/);
  assert.match(out.failures[0], /sub pragul de esec/);
  assert.equal(out.warnings.length, 0);
});

test("evaluateBenchmarkGuard: paritate divergenta -> esec, indiferent de viteza", () => {
  const out = evaluateBenchmarkGuard([
    sample({ area: "levenshtein", speedup: 3.0, parityOk: false })
  ], CONFIG);
  assert.equal(out.failures.length, 1);
  assert.match(out.failures[0], /paritate/);
});

test("evaluateBenchmarkGuard: Rust indisponibil sau speedup null -> sarit, fara esec (CI-safe)", () => {
  const out = evaluateBenchmarkGuard([
    sample({ area: "levenshtein", rustAvailable: false, speedup: null }),
    sample({ area: "dealHash", rustAvailable: true, speedup: null })
  ], CONFIG);
  assert.equal(out.failures.length, 0);
  assert.equal(out.warnings.length, 0);
  assert.equal(out.skipped.length, 2);
});

test("evaluateBenchmarkGuard: exact la pragul de esec nu esueaza (strict mai mic)", () => {
  const out = evaluateBenchmarkGuard([
    sample({ area: "dealHash", speedup: 0.85 })
  ], CONFIG);
  assert.equal(out.failures.length, 0);
});

test("defaultGuardConfig: praguri implicite + suprascriere prin env", () => {
  const base = defaultGuardConfig();
  assert.equal(base.failBelow, 0.85);
  assert.equal(base.warnBelow.levenshtein, 1.4);
  assert.equal(base.warnBelow.dealHash, 1.2);

  const prev = process.env.BENCH_HOTPATH_FAIL_RATIO;
  process.env.BENCH_HOTPATH_FAIL_RATIO = "1";
  try {
    assert.equal(defaultGuardConfig().failBelow, 1);
  } finally {
    if (prev === undefined) delete process.env.BENCH_HOTPATH_FAIL_RATIO; else process.env.BENCH_HOTPATH_FAIL_RATIO = prev;
  }
});

test("HOT_PATH_AREAS enumera doar functiile pe care BENCHMARKS.md le pastreaza in Rust", () => {
  assert.deepEqual([...HOT_PATH_AREAS], ["levenshtein", "dealHash"]);
});

test("CI si package.json ruleaza guard-ul de benchmark", () => {
  const srcRoot = process.cwd();
  const repoRoot = path.resolve(srcRoot, "..");
  const ci = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(ci, /benchmarkGuard\.js/, "ci.yml ruleaza guard-ul dupa build");
  const pkg = JSON.parse(fs.readFileSync(path.join(srcRoot, "package.json"), "utf8"));
  assert.equal(typeof pkg.scripts["benchmark:guard"], "string", "exista scriptul npm benchmark:guard");
});
