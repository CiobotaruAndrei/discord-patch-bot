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

test("dependency-review ruleaza actiunea blocking gated pe dependency graph", () => {
  const text = read(dependencyReviewPath);
  assert.match(text, /actions\/dependency-review-action@v4/, "foloseste dependency-review-action");
  assert.match(text, /fail-on-severity:\s*moderate/, "blocheaza la severitate moderate+");
  assert.match(text, /dependency_graph\?\.status/, "verifica daca dependency graph e activat");
  assert.match(text, /steps\.dependency-graph\.outputs\.result == 'true'/, "ruleaza actiunea doar cand graph-ul e activat");
  assert.ok(!/^\s*paths:/m.test(text), "ruleaza pe toate PR-urile catre main (fara filtru paths), deci e requireable ca status check");
});

test("SECURITY.md documenteaza setarile de repo de securitate (confirmate enabled)", () => {
  const text = read(securityPath);
  assert.match(text, /Dependency graph/, "documenteaza dependency graph");
  assert.match(text, /Dependabot security updates/, "documenteaza Dependabot security updates");
  assert.match(text, /required status checks/i, "documenteaza required status checks in branch protection");
  assert.match(text, /Dependency Review/, "documenteaza Dependency Review ca status check pe fiecare PR");
});
