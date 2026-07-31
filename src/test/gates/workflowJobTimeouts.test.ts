import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

const CARRIAGE_RETURN = String.fromCharCode(13);
const WORKFLOW_DIR = path.join(process.cwd(), "..", ".github", "workflows");
const MAX_TIMEOUT_MINUTES = 45;

interface WorkflowJob {
  workflow: string;
  name: string;
  body: string;
}

function workflowFiles(): string[] {
  return fs.readdirSync(WORKFLOW_DIR).filter(file => file.endsWith(".yml")).sort();
}

function readWorkflow(file: string): string {
  return fs.readFileSync(path.join(WORKFLOW_DIR, file), "utf8").split(CARRIAGE_RETURN).join("");
}

function jobsOf(file: string): WorkflowJob[] {
  const content = readWorkflow(file);
  const start = content.indexOf("\njobs:\n");
  if (start < 0) return [];
  const section = content.slice(start + "\njobs:\n".length);
  const lines = section.split("\n");
  const jobs: WorkflowJob[] = [];
  let current: WorkflowJob | null = null;
  for (const line of lines) {
    const header = /^ {2}([a-z][a-z0-9_-]*):\s*$/.exec(line);
    if (header) {
      current = { workflow: file, name: header[1], body: "" };
      jobs.push(current);
      continue;
    }
    if (/^\S/.test(line) && line.trim() !== "") current = null;
    if (current) current.body += `${line}\n`;
  }
  return jobs;
}

function declaredTimeout(job: WorkflowJob): number | null {
  const match = /^ {4}timeout-minutes:\s*(\d+)\s*$/m.exec(job.body);
  return match ? Number(match[1]) : null;
}

const allJobs = workflowFiles().flatMap(jobsOf);

test("fiecare job de workflow isi declara timeout-minutes", () => {
  const missing = allJobs.filter(job => declaredTimeout(job) === null).map(job => `${job.workflow}:${job.name}`);
  assert.deepEqual(
    missing,
    [],
    "fara `timeout-minutes`, GitHub lasa un job blocat sa ruleze pana la limita implicita de 6 ore, iar PR-ul ramane " +
      `agatat in loc sa pice si sa poata fi reluat. Masurat: un \`apt-get\` blocat pe lock-ul dpkg a tinut jobul \`check\` ` +
      `peste 12 minute, fata de ~15s normal. Joburile fara timeout: ${missing.join(", ")}`
  );
});

test("timeout-urile raman plafoane de siguranta, nu limite care taie rulari sanatoase", () => {
  const tooLong = allJobs
    .map(job => ({ job, minutes: declaredTimeout(job) ?? 0 }))
    .filter(entry => entry.minutes > MAX_TIMEOUT_MINUTES)
    .map(entry => `${entry.job.workflow}:${entry.job.name}=${entry.minutes}`);
  assert.deepEqual(
    tooLong,
    [],
    `un timeout peste ${MAX_TIMEOUT_MINUTES} de minute nu mai prinde un blocaj intr-un timp util: ${tooLong.join(", ")}`
  );
  const tooShort = allJobs
    .map(job => ({ job, minutes: declaredTimeout(job) ?? 0 }))
    .filter(entry => entry.minutes < 5)
    .map(entry => `${entry.job.workflow}:${entry.job.name}=${entry.minutes}`);
  assert.deepEqual(tooShort, [], `sub 5 minute un job sanatos poate pica din cauza unui runner lent: ${tooShort.join(", ")}`);
});

test("instalarea de pachete apt nu poate astepta la nesfarsit lock-ul dpkg", () => {
  const offenders: string[] = [];
  for (const file of workflowFiles()) {
    const content = readWorkflow(file);
    if (!content.includes("apt-get install")) continue;
    for (const command of content.split("\n").filter(line => line.includes("apt-get"))) {
      const trimmed = command.trim();
      if (!/^(if )?sudo apt-get|^apt-get/.test(trimmed)) continue;
      if (trimmed.includes("apt-get upgrade")) continue;
      if (!command.includes("DPkg::Lock::Timeout")) offenders.push(`${file}: ${command.trim().slice(0, 60)}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "`apt-get` asteapta implicit la infinit dupa lock-ul dpkg tinut de `unattended-upgrades`, deci un job poate ramane " +
      `blocat fara niciun semn de eroare. \`-o DPkg::Lock::Timeout\` il face sa esueze si sa poata fi reluat: ${offenders.join(" | ")}`
  );
});

test("pasul de apt are propriul timeout si reia incercarea", () => {
  const content = readWorkflow("ci.yml");
  const step = content.slice(content.indexOf("- name: Install native library dependencies"));
  const body = step.slice(0, step.indexOf("- name: Setup Rust"));
  assert.match(body, /timeout-minutes: \d+/, "pasul isi declara propriul timeout, ca sa pice inaintea jobului intreg");
  assert.match(body, /for attempt in/, "o retea sau un mirror cu sughit nu trebuie sa pice tot jobul din prima");
  assert.match(body, /unattended-upgrades/, "procesul care tine lock-ul dpkg e oprit inainte de instalare");
});
