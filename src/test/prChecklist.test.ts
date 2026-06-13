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

test("PR template cere bifele pentru regulile PDF (docs, teste, no-comments, benchmark, conflict, tooling nativ, fisiere)", () => {
  assert.ok(fs.existsSync(templatePath), ".github/pull_request_template.md exista");
  const text = read(templatePath);
  assert.match(text, /-\s*\[ \][^\n]*\*\*[Dd]ocumentatie\*\*/, "checkbox de documentatie (reflectata in docs)");
  assert.match(text, /-\s*\[ \][^\n]*\*\*[Tt]este\*\*/, "checkbox de teste (pentru functionalitatea noua)");
  assert.match(text, /-\s*\[ \][^\n]*[Cc]omentarii/, "checkbox fara comentarii / secrete");
  assert.match(text, /-\s*\[ \][^\n]*\*\*[Bb]enchmark\*\*/, "checkbox benchmark daca e hot-path / schimbare de limbaj");
  assert.match(text, /-\s*\[ \][^\n]*[Cc]onflict cu/, "checkbox fara conflict cu main");
  assert.match(text, /-\s*\[ \][^\n]*[Tt]ooling nativ/, "checkbox tooling nativ Cargo");
  assert.match(text, /-\s*\[ \][^\n]*[Ff]isiere noi numite dupa functionalitate/, "checkbox fisiere numite dupa functionalitate");
  assert.match(text, /npm run check/, "checklist mentioneaza poarta de verificare");
  assert.match(text, /npm audit/, "checklist mentioneaza auditul de dependinte");
});

test("workflow-ul PR Checklist impune bifele cheie (docs, teste, no-comments, benchmark, conflict) cu skip pentru boti", () => {
  assert.ok(fs.existsSync(workflowPath), "pr-checklist.yml exista");
  const text = read(workflowPath);
  assert.match(text, /pull_request:/, "ruleaza pe pull_request");
  assert.match(text, /\[Dd\]ocumentatie/, "verifica bifa de documentatie in body");
  assert.match(text, /\[Tt\]este/, "verifica bifa de teste in body");
  assert.match(text, /\[Cc\]omentarii/, "verifica bifa fara comentarii / secrete");
  assert.match(text, /\[Bb\]enchmark/, "verifica bifa de benchmark");
  assert.match(text, /\[Cc\]onflict cu/, "verifica bifa fara conflict cu main");
  assert.match(text, /core\.setFailed/, "esueaza check-ul cand lipseste o bifa");
  assert.match(text, /\[bot\]/, "sare peste PR-urile de la boti (ex. dependabot)");
});

test("workflow-ul PR Checklist verifica adevarul bifelor din diff, nu doar prezenta lor", () => {
  const text = read(workflowPath);
  assert.match(text, /listFiles/, "interogheaza fisierele schimbate de PR");
  assert.match(text, /codeChanged/, "detecteaza daca PR-ul atinge cod");
  assert.match(text, /sustinuta de diff/, "respinge bife nesustinute de diff");
  assert.match(text, /src\/test\//, "cere ca diff-ul de cod sa atinga si teste");
  assert.match(text, /bifa de documentatie nu e sustinuta de diff/, "cere ca diff-ul de cod sa atinga si documentatie");
});
