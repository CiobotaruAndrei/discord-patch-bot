import test from "node:test";
import assert from "node:assert/strict";

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");

const srcRoot = process.cwd();
const repoRoot = path.resolve(srcRoot, "..");
const dependabotPath = path.join(repoRoot, ".github", "dependabot.yml");
const dependencyReviewPath = path.join(repoRoot, ".github", "workflows", "dependency-review.yml");
const securityPath = path.join(repoRoot, "SECURITY.md");

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

test("dependabot acopera npm, github-actions si cargo (crate-ul Rust)", () => {
  const text = read(dependabotPath);
  assert.match(text, /package-ecosystem:\s*"npm"/, "ecosistem npm");
  assert.match(text, /package-ecosystem:\s*"github-actions"/, "ecosistem github-actions");
  assert.match(text, /package-ecosystem:\s*"cargo"/, "ecosistem cargo (Rust)");
  assert.match(text, /directory:\s*"\/src\/native"/, "cargo pointeaza catre crate-ul Rust din /src/native");
});

test("dependency-review ruleaza actiunea blocking neconditionat (fail-closed real)", () => {
  const text = read(dependencyReviewPath);
  assert.match(text, /actions\/dependency-review-action@v\d+/, "foloseste dependency-review-action");
  assert.match(text, /fail-on-severity:\s*moderate/, "blocheaza la severitate moderate+");
  assert.ok(!/dependency-graph\b/.test(text) && !/dependency_graph\?\.status/.test(text), "fara gate pe statusul dependency graph (nesigur pe repo-uri publice, unde graph-ul e mereu activat dar API-ul intoarce undefined - masca faptul ca actiunea nu rula niciodata)");
  assert.ok(!/if:\s/.test(text), "actiunea ruleaza neconditionat (fara `if:` care ar putea-o sari -> verde fals)");
  assert.ok(!/^\s*paths:/m.test(text), "ruleaza pe toate PR-urile catre main (fara filtru paths), deci e requireable ca status check");
});

test("scripturile de staging smoke nu mai raporteaza verde la skip fara opt-out explicit", () => {
  const httpSmoke = read(path.join(repoRoot, "src", "scripts", "stagingSmoke.ts"));
  const discordSmoke = read(path.join(repoRoot, "src", "scripts", "stagingDiscordSmoke.ts"));
  for (const text of [httpSmoke, discordSmoke]) {
    assert.match(text, /ALLOW_STAGING_SMOKE_SKIP/, "skip-ul cere ALLOW_STAGING_SMOKE_SKIP=true");
    assert.match(text, /return 1/, "fara opt-out, lipsa secretelor inseamna esec (exit non-zero), nu verde fals");
  }
});

test("SECURITY.md documenteaza setarile de repo de securitate (confirmate enabled)", () => {
  const text = read(securityPath);
  assert.match(text, /Dependency graph/, "documenteaza dependency graph");
  assert.match(text, /Dependabot security updates/, "documenteaza Dependabot security updates");
  assert.match(text, /required status checks/i, "documenteaza required status checks in branch protection");
  assert.match(text, /Dependency Review/, "documenteaza Dependency Review ca status check pe fiecare PR");
});
