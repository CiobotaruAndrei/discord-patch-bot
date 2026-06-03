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
