"use strict";

import { spawn } from "node:child_process";

export interface GateSpec {
  name: string;
  script: string;
  args: string[];
}

export interface GateOutcome {
  name: string;
  code: number;
  output: string;
  durationMs: number;
}

export const PROJECT_GATES: readonly GateSpec[] = [
  { name: "syntax", script: "dist/scripts/check-syntax.js", args: [] },
  { name: "comentarii", script: "dist/scripts/check-no-comments.js", args: [] },
  { name: "octeti NUL", script: "dist/scripts/check-no-nul-bytes.js", args: [] },
  { name: "marcatori de conflict", script: "dist/scripts/check-no-conflict-markers.js", args: [] },
  { name: "tipare slabita", script: "dist/scripts/check-no-weakening-types.js", args: [] },
  { name: "config", script: "dist/scripts/check-config.js", args: [] },
  { name: "dependinte", script: "dist/scripts/check-dependencies.js", args: [] },
  { name: "importuri intre straturi", script: "dist/scripts/check-layer-imports.js", args: [] },
  { name: "sincronizare reguli", script: "dist/scripts/check-rules-sync.js", args: [] },
  { name: "indecsi Mongo", script: "dist/scripts/check-db-indexes.js", args: [] },
  { name: "referinta comenzi", script: "dist/scripts/generate-command-reference.js", args: ["--check"] }
];

export function runGate(gate: GateSpec): Promise<GateOutcome> {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(process.execPath, [gate.script, ...gate.args], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += String(chunk); });
    child.stderr.on("data", chunk => { output += String(chunk); });
    child.on("error", error => {
      resolve({ name: gate.name, code: 1, output: `${output}${error instanceof Error ? error.message : String(error)}\n`, durationMs: Date.now() - started });
    });
    child.on("close", code => {
      resolve({ name: gate.name, code: code ?? 1, output, durationMs: Date.now() - started });
    });
  });
}

export async function runGates(gates: readonly GateSpec[] = PROJECT_GATES): Promise<GateOutcome[]> {
  return Promise.all(gates.map(gate => runGate(gate)));
}

export function summarize(outcomes: readonly GateOutcome[]): { failed: GateOutcome[]; report: string } {
  const failed = outcomes.filter(outcome => outcome.code !== 0);
  const lines = outcomes.map(outcome => `${outcome.code === 0 ? "OK  " : "PICA"} ${outcome.name} (${outcome.durationMs} ms)`);
  return { failed, report: lines.join("\n") };
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("run-gates.js")) {
  const outcomes = await runGates();
  const { failed, report } = summarize(outcomes);
  console.log(report);
  for (const outcome of failed) {
    console.log(`\n----- ${outcome.name} -----`);
    console.log(outcome.output.trimEnd());
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length} gate-uri au picat: ${failed.map(outcome => outcome.name).join(", ")}`);
    process.exit(1);
  }
}
