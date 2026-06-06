"use strict";

import { runCpuBenchmark, runAreaBenchmarks, levenshteinParityMismatches } from "./cpuBenchmark";

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

export const HOT_PATH_AREAS = ["levenshtein", "dealHash", "rankListingCandidates"] as const;

export function defaultGuardConfig(): GuardConfig {
  return {
    failBelow: Number(process.env.BENCH_HOTPATH_FAIL_RATIO) || 0.85,
    warnBelow: {
      levenshtein: Number(process.env.BENCH_LEVENSHTEIN_WARN_RATIO) || 1.4,
      dealHash: Number(process.env.BENCH_DEALHASH_WARN_RATIO) || 1.2,
      rankListingCandidates: Number(process.env.BENCH_RANKLISTING_WARN_RATIO) || 1.1
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

function bestSpeedup(runner: () => number | null, runs: number): number | null {
  let best: number | null = null;
  for (let i = 0; i < runs; i++) {
    const value = runner();
    if (value === null) return null;
    if (best === null || value > best) best = value;
  }
  return best;
}

export function collectGuardSamples(runs = Number(process.env.BENCH_GUARD_RUNS) || 3): GuardSample[] {
  const levenshteinSpeedup = bestSpeedup(() => runCpuBenchmark().speedup, runs);
  const firstCpu = runCpuBenchmark();
  const levenshteinParityOk = levenshteinParityMismatches().length === 0;

  const dealHashSpeedup = bestSpeedup(() => {
    const area = runAreaBenchmarks().find(a => a.area.includes("dealHash"));
    return area ? area.speedup : null;
  }, runs);
  const dealHashArea = runAreaBenchmarks().find(a => a.area.includes("dealHash"));

  const listingRankSpeedup = bestSpeedup(() => {
    const area = runAreaBenchmarks().find(a => a.area.includes("listing-rank"));
    return area ? area.speedup : null;
  }, runs);
  const listingRankArea = runAreaBenchmarks().find(a => a.area.includes("listing-rank"));

  return [
    {
      area: "levenshtein",
      rustAvailable: firstCpu.rustAvailable,
      speedup: levenshteinSpeedup,
      parityOk: levenshteinParityOk
    },
    {
      area: "dealHash",
      rustAvailable: dealHashArea ? dealHashArea.rustAvailable : firstCpu.rustAvailable,
      speedup: dealHashSpeedup,
      parityOk: dealHashArea ? dealHashArea.parityOk : true
    },
    {
      area: "rankListingCandidates",
      rustAvailable: listingRankArea ? listingRankArea.rustAvailable : firstCpu.rustAvailable,
      speedup: listingRankSpeedup,
      parityOk: listingRankArea ? listingRankArea.parityOk : true
    }
  ];
}

if (require.main === module) {
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
