import test from "node:test";
import assert from "node:assert/strict";

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");

const srcRoot = process.cwd();
const repoRoot = path.resolve(srcRoot, "..");
const releasingPath = path.join(repoRoot, "RELEASING.md");
const releaseWorkflowPath = path.join(repoRoot, ".github", "workflows", "release.yml");

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

test("RELEASING.md documenteaza gate-ul complet (CI, dependency review, staging smoke, manual Discord smoke)", () => {
  assert.ok(fs.existsSync(releasingPath), "RELEASING.md exista");
  const text = read(releasingPath);
  assert.match(text, /npm run check|CI .*verde|\bcheck\b/, "CI / check");
  assert.match(text, /Dependency Review|dependency-review/, "dependency review");
  assert.match(text, /npm audit/, "audit dependinte");
  assert.match(text, /smoke:staging/, "staging smoke automat");
  assert.match(text, /STAGING_SMOKE\.md/, "manual Discord smoke");
  assert.match(text, /CHANGELOG\.md/, "CHANGELOG actualizat");
});

test("release.yml impune CI + audit + confirmarea smoke la dispatch", () => {
  const text = read(releaseWorkflowPath);
  assert.match(text, /run: npm run check/, "ruleaza CI la release");
  assert.match(text, /npm audit --omit=dev --audit-level=moderate/, "ruleaza audit la release (blocking)");
  assert.match(text, /smoke_confirmed:/, "expune input-ul smoke_confirmed");
  assert.match(text, /SMOKE_CONFIRMED/, "verifica confirmarea in gate-ul de release");
  assert.match(text, /Release blocat/, "esueaza explicit fara confirmare la dispatch");
});

test("release.yml se declanseaza doar prin workflow_dispatch (fara cale de tag push care ocoleste smoke)", () => {
  const text = read(releaseWorkflowPath);
  const onStart = text.indexOf("\non:");
  const onEnd = text.indexOf("\npermissions:");
  assert.ok(onStart >= 0 && onEnd > onStart, "blocul on: este localizabil");
  const onBlock = text.slice(onStart, onEnd);
  assert.match(onBlock, /workflow_dispatch:/, "are trigger workflow_dispatch");
  assert.ok(!/\bpush:/.test(onBlock), "blocul on: nu contine trigger push");
  assert.ok(!/\btags:/.test(onBlock), "blocul on: nu contine trigger pe push de tag-uri (calea care ocolea confirmarea smoke)");
  assert.ok(!text.includes("EVENT_NAME"), "gate-ul nu mai e conditionat de tipul evenimentului — cere confirmarea neconditionat");
});
