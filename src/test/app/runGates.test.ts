import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { PROJECT_GATES, runGate, summarize, type GateOutcome } from "../../scripts/run-gates.js";

const RUNTIME_ONLY_CHECKS = ["check-env.ts", "check-mongo.ts", "check-redis.ts"];

function outcome(name: string, code: number): GateOutcome {
  return { name, code, output: code === 0 ? "" : `${name} a raportat o problema`, durationMs: 1 };
}

test("fiecare validator static este in lista de gate-uri; unul nou trebuie clasificat explicit", () => {
  const scriptsDir = path.resolve(import.meta.dirname, "../../scripts");
  const found = fs.readdirSync(scriptsDir).filter(entry => entry.startsWith("check-") && entry.endsWith(".ts"));
  const wired = PROJECT_GATES.map(gate => path.basename(gate.script).replace(/\.js$/, ".ts"));

  for (const entry of found) {
    assert.ok(
      wired.includes(entry) || RUNTIME_ONLY_CHECKS.includes(entry),
      `${entry} nu ruleaza in check si nu e marcat ca verificare de runtime — un gate nou nu are voie sa dispara tacit`
    );
  }
  assert.ok(wired.includes("generate-command-reference.ts"), "verificarea referintei de comenzi ramane in lant");
});

test("un gate care pica isi raporteaza codul si iesirea, nu doar esecul", async () => {
  const result = await runGate({ name: "sonda", script: "-e", args: ["console.log('detaliu util'); process.exit(3);"] });
  assert.equal(result.code, 3);
  assert.match(result.output, /detaliu util/);
});

test("un gate care trece raporteaza cod zero", async () => {
  const result = await runGate({ name: "sonda", script: "-e", args: ["process.exit(0);"] });
  assert.equal(result.code, 0);
});

test("raportul aduna TOATE gate-urile picate, nu se opreste la primul", () => {
  const { failed, report } = summarize([
    outcome("syntax", 0),
    outcome("comentarii", 1),
    outcome("config", 0),
    outcome("indecsi Mongo", 1)
  ]);

  assert.deepEqual(failed.map(entry => entry.name), ["comentarii", "indecsi Mongo"]);
  assert.match(report, /OK\s+syntax/);
  assert.match(report, /PICA comentarii/);
  assert.match(report, /PICA indecsi Mongo/);
});
