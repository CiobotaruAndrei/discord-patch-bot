import test from "node:test";
import assert from "node:assert/strict";

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");

const srcRoot = process.cwd();
const repoRoot = path.resolve(srcRoot, "..");
const templatePath = path.join(repoRoot, ".github", "pull_request_template.md");
const workflowPath = path.join(repoRoot, ".github", "workflows", "pr-checklist.yml");

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

test("PR template cere bifa pentru documentatie si teste", () => {
  assert.ok(fs.existsSync(templatePath), ".github/pull_request_template.md exista");
  const text = read(templatePath);
  assert.match(text, /-\s*\[ \][^\n]*[Dd]ocumentatie/, "checkbox de documentatie (Regula 2)");
  assert.match(text, /-\s*\[ \][^\n]*[Tt]este/, "checkbox de teste (Regula 4)");
  assert.match(text, /npm run check/, "checklist mentioneaza poarta de verificare");
});

test("workflow-ul PR Checklist impune bifele de docs + teste (cu skip pentru boti)", () => {
  assert.ok(fs.existsSync(workflowPath), "pr-checklist.yml exista");
  const text = read(workflowPath);
  assert.match(text, /pull_request:/, "ruleaza pe pull_request");
  assert.match(text, /\[Dd\]ocument/, "verifica bifa de documentatie in body");
  assert.match(text, /\[Tt\]este/, "verifica bifa de teste in body");
  assert.match(text, /core\.setFailed/, "esueaza check-ul cand lipseste o bifa");
  assert.match(text, /\[bot\]/, "sare peste PR-urile de la boti (ex. dependabot)");
});
