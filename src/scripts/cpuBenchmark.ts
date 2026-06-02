"use strict";

import { getNativeFuzzy, levenshteinFallback, isRustFuzzyAvailable } from "../native/fuzzy";

const SAMPLE_PAIRS: Array<[string, string]> = [
  ["counter strike 2", "counter-strike 2"],
  ["the witcher 3 wild hunt", "witcher 3"],
  ["baldurs gate 3", "baldur's gate iii"],
  ["cyberpunk 2077", "cyberpunk2077"],
  ["red dead redemption 2", "rdr2"],
  ["elden ring", "elder ring"],
  ["grand theft auto v", "gta 5"],
  ["minecraft", "mine craft"]
];

interface TimedResult {
  totalMs: number;
  callsPerSecond: number;
}

export interface CpuBenchmarkResult {
  iterations: number;
  callsPerIteration: number;
  rustAvailable: boolean;
  ts: TimedResult;
  native: TimedResult | null;
  speedup: number | null;
}

function timeLoop(fn: () => void, iterations: number): TimedResult {
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  const totalMs = Number(process.hrtime.bigint() - start) / 1e6;
  const totalCalls = iterations * SAMPLE_PAIRS.length;
  return { totalMs, callsPerSecond: totalCalls / (totalMs / 1000) };
}

export function levenshteinParityMismatches(): Array<{ pair: [string, string]; native: number; ts: number }> {
  const native = getNativeFuzzy();
  if (!native) return [];
  const mismatches: Array<{ pair: [string, string]; native: number; ts: number }> = [];
  for (const pair of SAMPLE_PAIRS) {
    const nativeValue = native.levenshtein(pair[0], pair[1]);
    const tsValue = levenshteinFallback(pair[0], pair[1]);
    if (nativeValue !== tsValue) mismatches.push({ pair, native: nativeValue, ts: tsValue });
  }
  return mismatches;
}

export function runCpuBenchmark(iterations = Number(process.env.CPU_BENCH_ITER) || 200_000): CpuBenchmarkResult {
  const native = getNativeFuzzy();
  const tsTimed = timeLoop(() => {
    for (const pair of SAMPLE_PAIRS) levenshteinFallback(pair[0], pair[1]);
  }, iterations);
  const nativeTimed = native
    ? timeLoop(() => { for (const pair of SAMPLE_PAIRS) native.levenshtein(pair[0], pair[1]); }, iterations)
    : null;
  const speedup = nativeTimed ? tsTimed.totalMs / nativeTimed.totalMs : null;
  return {
    iterations,
    callsPerIteration: SAMPLE_PAIRS.length,
    rustAvailable: isRustFuzzyAvailable(),
    ts: tsTimed,
    native: nativeTimed,
    speedup
  };
}

if (require.main === module) {
  const result = runCpuBenchmark();
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
  console.log(`CPU benchmark (levenshtein), ${fmt(result.iterations)} iteratii x ${result.callsPerIteration} apeluri`);
  console.log(`- TS fallback: ${result.ts.totalMs.toFixed(1)}ms, ${fmt(result.ts.callsPerSecond)} apeluri/s`);
  if (result.native) {
    console.log(`- Rust native: ${result.native.totalMs.toFixed(1)}ms, ${fmt(result.native.callsPerSecond)} apeluri/s`);
    console.log(`- Speedup native vs TS: ${result.speedup ? result.speedup.toFixed(2) : "-"}x`);
    const mismatches = levenshteinParityMismatches();
    console.log(`- Paritate native==TS: ${mismatches.length === 0 ? "OK" : `${mismatches.length} diferente`}`);
  } else {
    console.log("- Rust native: indisponibil (foloseste fallback TS).");
  }
}

export {};
