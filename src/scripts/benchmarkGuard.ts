import { pathToFileURL as __pathToFileURL } from "node:url";
"use strict";

import { runCpuBenchmark, runAreaBenchmarks, levenshteinParityMismatches } from "./cpuBenchmark.js";
import type { AreaBenchmarkResult } from "./cpuBenchmark.js";
import { strictEnvFloat, strictEnvInt } from "./benchmarkEnv.js";

export interface GuardSample {
  area: string;
  rustAvailable: boolean;
  speedup: number | null;
  parityOk: boolean;
}

export interface GuardConfig {
  failBelow: number;
  warnBelow: Record<string, number>;
  requireNative: boolean;
}

export interface GuardOutcome {
  failures: string[];
  warnings: string[];
  skipped: string[];
}

export const HOT_PATH_AREAS = ["levenshtein", "dealHash", "stableUpdateId", "rankListingCandidates"] as const;

export function defaultGuardConfig(): GuardConfig {
  return {
    failBelow: strictEnvFloat("BENCH_HOTPATH_FAIL_RATIO", 0.85),
    warnBelow: {
      levenshtein: strictEnvFloat("BENCH_LEVENSHTEIN_WARN_RATIO", 1.4),
      dealHash: strictEnvFloat("BENCH_DEALHASH_WARN_RATIO", 1.2),
      stableUpdateId: strictEnvFloat("BENCH_STABLEUPDATE_WARN_RATIO", 1.2),
      rankListingCandidates: strictEnvFloat("BENCH_RANKLISTING_WARN_RATIO", 1.1)
    },
    requireNative: process.env.BENCH_GUARD_REQUIRE_NATIVE === "true"
  };
}

export function evaluateBenchmarkGuard(samples: GuardSample[], config: GuardConfig): GuardOutcome {
  const failures: string[] = [];
  const warnings: string[] = [];
  const skipped: string[] = [];
  for (const sample of samples) {
    if (!sample.rustAvailable || sample.speedup === null) {
      if (config.requireNative) {
        failures.push(`${sample.area}: addon nativ indisponibil dar BENCH_GUARD_REQUIRE_NATIVE=true — in CI build-ul Rust ruleaza inainte de guard, deci absenta inseamna o problema de build, nu un skip acceptabil`);
      } else {
        skipped.push(`${sample.area}: Rust indisponibil, guard de viteza sarit`);
      }
      continue;
    }
    if (!sample.parityOk) {
      failures.push(`${sample.area}: paritate native != TS (rezultate divergente) — bug de corectitudine, nu de viteza`);
      continue;
    }
    if (sample.speedup < config.failBelow) {
      failures.push(`${sample.area}: Rust ${sample.speedup.toFixed(2)}x sub pragul de esec ${config.failBelow.toFixed(2)}x — Rust e mai lent decat TS pe un hot-path pe care BENCHMARKS.md il pastreaza in Rust (regula 6/14): muta-l in TS sau investigheaza regresia`);
      continue;
    }
    const warnBelow = config.warnBelow[sample.area];
    if (typeof warnBelow === "number" && sample.speedup < warnBelow) {
      warnings.push(`${sample.area}: Rust ${sample.speedup.toFixed(2)}x sub pragul asteptat ${warnBelow.toFixed(2)}x din BENCHMARKS.md — avantajul Rust se erodeaza, verifica daca mai merita`);
    }
  }
  return { failures, warnings, skipped };
}

function bestOf(values: Array<number | null>): number | null {
  let best: number | null = null;
  for (const value of values) {
    if (value === null) return null;
    if (best === null || value > best) best = value;
  }
  return best;
}

export interface GuardBenchmarkDeps {
  runCpuBenchmark: typeof runCpuBenchmark;
  runAreaBenchmarks: typeof runAreaBenchmarks;
  levenshteinParityMismatches: typeof levenshteinParityMismatches;
}

const defaultBenchmarkDeps: GuardBenchmarkDeps = { runCpuBenchmark, runAreaBenchmarks, levenshteinParityMismatches };

export function collectGuardSamples(
  runs = strictEnvInt("BENCH_GUARD_RUNS", 3),
  deps: GuardBenchmarkDeps = defaultBenchmarkDeps
): GuardSample[] {
  const totalRuns = Math.max(1, runs);

  const levenshteinValues: Array<number | null> = [];
  let levenshteinRustAvailable = false;
  for (let i = 0; i < totalRuns; i++) {
    const cpu = deps.runCpuBenchmark();
    if (i === 0) levenshteinRustAvailable = cpu.rustAvailable;
    levenshteinValues.push(cpu.speedup);
  }
  const levenshteinParityOk = deps.levenshteinParityMismatches().length === 0;

  const dealHashValues: Array<number | null> = [];
  const stableUpdateIdValues: Array<number | null> = [];
  const listingRankValues: Array<number | null> = [];
  let dealHashArea: AreaBenchmarkResult | undefined;
  let stableUpdateIdArea: AreaBenchmarkResult | undefined;
  let listingRankArea: AreaBenchmarkResult | undefined;
  for (let i = 0; i < totalRuns; i++) {
    const areas = deps.runAreaBenchmarks();
    const dealHash = areas.find(a => a.key === "dealHash");
    const stableUpdateId = areas.find(a => a.key === "stableUpdateId");
    const listingRank = areas.find(a => a.key === "rankListingCandidates");
    if (i === 0) {
      dealHashArea = dealHash;
      stableUpdateIdArea = stableUpdateId;
      listingRankArea = listingRank;
    }
    dealHashValues.push(dealHash ? dealHash.speedup : null);
    stableUpdateIdValues.push(stableUpdateId ? stableUpdateId.speedup : null);
    listingRankValues.push(listingRank ? listingRank.speedup : null);
  }

  return [
    {
      area: "levenshtein",
      rustAvailable: levenshteinRustAvailable,
      speedup: bestOf(levenshteinValues),
      parityOk: levenshteinParityOk
    },
    {
      area: "dealHash",
      rustAvailable: dealHashArea ? dealHashArea.rustAvailable : levenshteinRustAvailable,
      speedup: bestOf(dealHashValues),
      parityOk: dealHashArea ? dealHashArea.parityOk : true
    },
    {
      area: "stableUpdateId",
      rustAvailable: stableUpdateIdArea ? stableUpdateIdArea.rustAvailable : levenshteinRustAvailable,
      speedup: bestOf(stableUpdateIdValues),
      parityOk: stableUpdateIdArea ? stableUpdateIdArea.parityOk : true
    },
    {
      area: "rankListingCandidates",
      rustAvailable: listingRankArea ? listingRankArea.rustAvailable : levenshteinRustAvailable,
      speedup: bestOf(listingRankValues),
      parityOk: listingRankArea ? listingRankArea.parityOk : true
    }
  ];
}

if (process.argv[1] !== undefined && __pathToFileURL(process.argv[1]).href === import.meta.url) {
  const config = defaultGuardConfig();
  const samples = collectGuardSamples();
  const outcome = evaluateBenchmarkGuard(samples, config);

  console.log("Benchmark hot-path guard (BENCHMARKS.md):");
  for (const sample of samples) {
    const speed = sample.speedup === null ? "n/a" : `${sample.speedup.toFixed(2)}x`;
    console.log(`- ${sample.area}: Rust vs TS ${speed}, paritate ${sample.parityOk ? "OK" : "DIFERENTE"}, rust ${sample.rustAvailable ? "disponibil" : "indisponibil"}`);
  }
  for (const skip of outcome.skipped) console.log(`[skip] ${skip}`);
  for (const warn of outcome.warnings) console.log(`::warning::[benchmark-guard] ${warn}`);
  for (const fail of outcome.failures) console.error(`::error::[benchmark-guard] ${fail}`);

  if (outcome.failures.length) {
    console.error(`Benchmark guard: ${outcome.failures.length} regresie(i) pe hot-path. Vezi BENCHMARKS.md.`);
    process.exit(1);
  }
  console.log(`Benchmark guard OK (${outcome.warnings.length} avertisment(e), ${outcome.skipped.length} sarit(e)).`);
}

export {};
