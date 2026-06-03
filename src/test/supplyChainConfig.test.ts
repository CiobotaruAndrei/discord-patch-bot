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
});

test("SECURITY.md documenteaza setarile de repo necesare (owner action)", () => {
  const text = read(securityPath);
  assert.match(text, /Dependency graph/, "documenteaza activarea dependency graph");
  assert.match(text, /Dependabot security updates/, "documenteaza Dependabot security updates");
  assert.match(text, /required status checks/i, "documenteaza marcarea check-urilor ca required in branch protection");
});
