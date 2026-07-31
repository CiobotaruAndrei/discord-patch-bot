import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

const CARRIAGE_RETURN = String.fromCharCode(13);

const workflow = fs
  .readFileSync(path.join(process.cwd(), "..", ".github", "workflows", "ci.yml"), "utf8")
  .split(CARRIAGE_RETURN)
  .join("");

function jobNames(): string[] {
  return [...workflow.matchAll(/^ {2}([a-z][a-z0-9_-]*):$/gm)].map(match => match[1]);
}

function jobBlock(name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `jobul ${name} exista`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9_-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

test("CI are un job rapid separat de jobul complet", () => {
  const names = jobNames();
  for (const name of ["gates", "check", "ci"]) {
    assert.ok(names.includes(name), `jobul ${name} exista in workflow`);
  }
});

test("jobul rapid nu plateste pregatirea scumpa a jobului complet", () => {
  const gates = jobBlock("gates");
  for (const [fragment, why] of [
    ["apt-get", "instalarea librariilor C dureaza ~34s si nu e nevoie de ea pentru gate-uri"],
    ["rust-toolchain", "setup-ul Rust nu e nevoie: build:ts nu atinge crate-ul"],
    ["rust-cache", "restaurarea cache-ului Rust e cel mai scump pas al CI (~96s masurat)"],
    ["services:", "gate-urile nu au nevoie de MongoDB"],
    ["build:rust", "jobul rapid nu construieste addon-ul nativ"]
  ] as ReadonlyArray<readonly [string, string]>) {
    assert.ok(
      !gates.includes(fragment),
      `jobul rapid contine "${fragment}", deci nu mai e rapid: ${why}. Daca ajunge sa aiba nevoie de asta, ` +
        "inseamna ca verificarea mutata acolo nu e potrivita pentru jobul rapid"
    );
  }
  assert.ok(gates.includes("npm run build:ts"), "jobul rapid compileaza TypeScript");
  assert.ok(gates.includes("check:gates:prebuilt"), "jobul rapid ruleaza gate-urile structurale");
});

test("jobul complet ramane cel care are Rust, Mongo si testele", () => {
  const check = jobBlock("check");
  for (const fragment of ["rust-toolchain", "rust-cache", "mongodb", "npm run check"]) {
    assert.ok(check.includes(fragment), `jobul complet pastreaza ${fragment}`);
  }
});

test("un singur check agregat decide rezultatul, si nu poate fi sarit tacut", () => {
  const ci = jobBlock("ci");
  assert.match(ci, /needs: \[gates, check\]/, "agregatorul depinde de ambele joburi");
  assert.match(
    ci,
    /if: always\(\)/,
    "fara `if: always()`, un job dependent esuat ar face agregatorul `skipped`, iar protectia de branch " +
      "ar vedea o stare care nu e nici succes, nici esec"
  );
  assert.match(ci, /exit 1/, "agregatorul chiar esueaza cand un dependinte nu a reusit");
  for (const result of ["needs.gates.result", "needs.check.result"]) {
    assert.ok(ci.includes(result), `agregatorul citeste rezultatul lui ${result.split(".")[1]}`);
  }
});
