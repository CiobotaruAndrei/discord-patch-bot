import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

const srcRoot = process.cwd();
const repoRoot = path.resolve(srcRoot, "..");
const workflowsDir = path.join(repoRoot, ".github", "workflows");

interface PackageJson {
  scripts: Record<string, string>;
}

const scripts: Record<string, string> = (
  JSON.parse(fs.readFileSync(path.join(srcRoot, "package.json"), "utf8")) as PackageJson
).scripts;

const BUILD_PREFIXES: readonly string[] = ["npm run build:ts && ", "npm run build && "];

const ORCHESTRATORS: ReadonlySet<string> = new Set([
  "build",
  "build:ts",
  "build:rust",
  "rebuild",
  "clean",
  "check",
  "check:full",
  "check:native",
  "check:ts-prebuilt",
  "precommit",
  "dev",
  "start:build",
  "typecheck",
  "audit",
  "audit:strict",
  "rules:sync"
]);

function runsCompiledArtifact(command: string): boolean {
  return /(?:^|&&\s*)node (?:--[^\s]+\s+)*(?:--test\s+)?"?dist\//.test(command);
}

test("niciun script nu construieste si ruleaza dist-ul in aceeasi comanda", () => {
  const offenders = Object.entries(scripts)
    .filter(([name]) => !ORCHESTRATORS.has(name))
    .filter(([, command]) => BUILD_PREFIXES.some(prefix => command.startsWith(prefix)) && runsCompiledArtifact(command))
    .map(([name]) => name);
  assert.deepEqual(
    offenders,
    [],
    `${offenders.join(", ")} construiesc si ruleaza dist-ul in aceeasi comanda. ` +
      "Fara o varianta :prebuilt separata, un workflow care a construit deja e obligat sa reconstruiasca " +
      "sau sa scrie calea catre dist de mana in YAML, unde nu o mai verifica nimeni."
  );
});

test("scriptul cu build deleaga la varianta :prebuilt, nu isi duplica propria comanda", () => {
  const offenders: string[] = [];
  for (const [name, command] of Object.entries(scripts)) {
    if (ORCHESTRATORS.has(name) || name.endsWith(":prebuilt")) continue;
    const prefix = BUILD_PREFIXES.find(candidate => command.startsWith(candidate));
    if (!prefix) continue;
    const expected = `${prefix}npm run ${name}:prebuilt`;
    if (command !== expected) offenders.push(`${name}: "${command}" != "${expected}"`);
  }
  assert.deepEqual(
    offenders,
    [],
    `comanda reala trebuie sa existe intr-un singur loc, in varianta :prebuilt: ${offenders.join(" | ")}`
  );
});

test("varianta :prebuilt nu construieste nimic", () => {
  const offenders = Object.entries(scripts)
    .filter(([name]) => name.endsWith(":prebuilt"))
    .filter(([, command]) => /npm run build(:|\s|$)|run-parallel\.ts|tsc\b|napi build/.test(command))
    .map(([name]) => name);
  assert.deepEqual(offenders, [], `${offenders.join(", ")} pretinde ca e prebuilt dar construieste`);
});

function workflowJobs(file: string): Array<{ job: string; body: string }> {
  const text = fs
    .readFileSync(path.join(workflowsDir, file), "utf8")
    .split("\n")
    .filter(line => !line.trim().startsWith("#"))
    .join("\n");
  const jobsIndex = text.indexOf("\njobs:");
  if (jobsIndex === -1) return [];
  const lines = text.slice(jobsIndex).split("\n");
  const jobs: Array<{ job: string; body: string }> = [];
  let current: { job: string; body: string[] } | null = null;
  for (const line of lines) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      if (current) jobs.push({ job: current.job, body: current.body.join("\n") });
      current = { job: header[1], body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) jobs.push({ job: current.job, body: current.body.join("\n") });
  return jobs;
}

function buildingInvocations(body: string): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)) {
    const name = match[1];
    const command = scripts[name];
    if (!command) continue;
    if (name === "build" || name === "build:ts" || name === "build:rust") {
      found.push(name);
      continue;
    }
    if (BUILD_PREFIXES.some(prefix => command.startsWith(prefix)) || /run-parallel\.ts build/.test(command)) {
      found.push(name);
    }
  }
  return found;
}

test("niciun job de workflow nu compileaza TypeScript de doua ori", () => {
  const offenders: string[] = [];
  for (const file of fs.readdirSync(workflowsDir).filter(name => name.endsWith(".yml"))) {
    for (const { job, body } of workflowJobs(file)) {
      const building = buildingInvocations(body);
      const compilesTs = building.filter(name => name !== "build:rust");
      if (compilesTs.length > 1) offenders.push(`${file}:${job} -> ${compilesTs.join(", ")}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "un job trebuie sa construiasca o singura data si sa refoloseasca dist-ul prin variantele :prebuilt; " +
      `job-uri care reconstruiesc: ${offenders.join(" | ")}`
  );
});

test("workflow-urile nu cheama scripturi din dist scriind calea de mana", () => {
  const offenders: string[] = [];
  for (const file of fs.readdirSync(workflowsDir).filter(name => name.endsWith(".yml"))) {
    for (const line of fs.readFileSync(path.join(workflowsDir, file), "utf8").split("\n")) {
      if (line.trim().startsWith("#")) continue;
      if (!/^\s*(run:|\s+)node (--[^\s]+\s+)*dist\//.test(line)) continue;
      offenders.push(`${file}: ${line.trim()}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "calea catre dist trebuie sa traiasca in package.json, intr-un script :prebuilt, nu in YAML: " +
      offenders.join(" | ")
  );
});
