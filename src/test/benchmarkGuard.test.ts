import test from "node:test";
import assert from "node:assert/strict";

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");

import { evaluateBenchmarkGuard, defaultGuardConfig, HOT_PATH_AREAS } from "../scripts/benchmarkGuard";
import type { GuardSample, GuardConfig } from "../scripts/benchmarkGuard";

const CONFIG: GuardConfig = { failBelow: 0.85, warnBelow: { levenshtein: 1.4, dealHash: 1.2 }, requireNative: false };

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

test("evaluateBenchmarkGuard: requireNative=true -> Rust indisponibil devine esec (gate strict de CI)", () => {
  const strict: GuardConfig = { ...CONFIG, requireNative: true };
  const out = evaluateBenchmarkGuard([
    sample({ area: "levenshtein", rustAvailable: false, speedup: null })
  ], strict);
  assert.equal(out.failures.length, 1);
  assert.match(out.failures[0], /addon nativ indisponibil/);
  assert.match(out.failures[0], /BENCH_GUARD_REQUIRE_NATIVE/);
  assert.equal(out.skipped.length, 0);
});

test("evaluateBenchmarkGuard: exact la pragul de esec nu esueaza (strict mai mic)", () => {
  const out = evaluateBenchmarkGuard([
    sample({ area: "dealHash", speedup: 0.85 })
  ], CONFIG);
  assert.equal(out.failures.length, 0);
});

test("defaultGuardConfig: praguri implicite + suprascriere prin env + requireNative", () => {
  const base = defaultGuardConfig();
  assert.equal(base.failBelow, 0.85);
  assert.equal(base.warnBelow.levenshtein, 1.4);
  assert.equal(base.warnBelow.dealHash, 1.2);
  assert.equal(base.requireNative, false, "implicit nu cere nativul (CI-safe local)");

  const prevFail = process.env.BENCH_HOTPATH_FAIL_RATIO;
  const prevReq = process.env.BENCH_GUARD_REQUIRE_NATIVE;
  process.env.BENCH_HOTPATH_FAIL_RATIO = "1";
  process.env.BENCH_GUARD_REQUIRE_NATIVE = "true";
  try {
    const cfg = defaultGuardConfig();
    assert.equal(cfg.failBelow, 1);
    assert.equal(cfg.requireNative, true, "BENCH_GUARD_REQUIRE_NATIVE=true activeaza gate-ul strict");
  } finally {
    if (prevFail === undefined) delete process.env.BENCH_HOTPATH_FAIL_RATIO; else process.env.BENCH_HOTPATH_FAIL_RATIO = prevFail;
    if (prevReq === undefined) delete process.env.BENCH_GUARD_REQUIRE_NATIVE; else process.env.BENCH_GUARD_REQUIRE_NATIVE = prevReq;
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
  assert.match(ci, /BENCH_GUARD_REQUIRE_NATIVE: "true"/, "ci.yml cere nativul (gate strict, fara skip cand build-ul Rust a rulat inainte)");
  const pkg = JSON.parse(fs.readFileSync(path.join(srcRoot, "package.json"), "utf8"));
  assert.equal(typeof pkg.scripts["benchmark:guard"], "string", "exista scriptul npm benchmark:guard");
});
