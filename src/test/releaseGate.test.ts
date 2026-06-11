import test from "node:test";
import assert from "node:assert/strict";

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");

const srcRoot = process.cwd();
const repoRoot = path.resolve(srcRoot, "..");
const releasingPath = path.join(repoRoot, "RELEASING.md");
const releaseWorkflowPath = path.join(repoRoot, ".github", "workflows", "release.yml");
const stagingSmokeWorkflowPath = path.join(repoRoot, ".github", "workflows", "staging-smoke.yml");

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

test("release.yml verifica un artifact real de staging smoke, nu doar smoke_confirmed=true", () => {
  const text = read(releaseWorkflowPath);
  assert.match(text, /actions: read/, "are permisiunea actions:read pentru a citi rularile de staging smoke");
  assert.match(text, /listWorkflowRuns/, "interogheaza rularile workflow-ului");
  assert.match(text, /workflow_id: 'staging-smoke\.yml'/, "tinteste workflow-ul de staging smoke");
  assert.match(text, /status: 'success'/, "cere o rulare reusita");
  assert.match(text, /STAGING_SMOKE_MAX_AGE_DAYS/, "impune o fereastra de prospetime configurabila");
  assert.match(text, /listWorkflowRunArtifacts/, "verifica existenta artifactului de rezultat");
  assert.match(text, /staging-smoke-result-\$\{tagSha\}/, "artifactul asteptat poarta SHA-ul commit-ului tag-ului (proba ca smoke-ul a rulat exact codul tag-ului)");
  assert.ok(!/head_sha === tagSha/.test(text),
    "gate-ul NU se mai ancoreaza pe head_sha al rularii (la dispatch cu input ref, head_sha e branch-ul de dispatch, nu codul testat)");
  assert.match(text, /actions\/download-artifact@[0-9a-f]{40}/, "descarca artifactul din rularea de staging smoke (action pinuita pe SHA)");
  assert.match(text, /name: \$\{\{ steps\.smoke\.outputs\.artifact_name \}\}/, "descarca exact artifactul identificat de gate");
  assert.match(text, /run-id: \$\{\{ steps\.smoke\.outputs\.run_id \}\}/, "descarca din rularea identificata");
  assert.match(text, /r\.skipped/, "respinge un rezultat sarit (skipped=true)");
  assert.match(text, /!r\.ok/, "respinge un rezultat esuat (ok=false)");
});

test("release.yml valideaza semver si publica :latest doar pentru release-uri stabile", () => {
  const text = read(releaseWorkflowPath);
  assert.match(text, /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+/, "valideaza forma semver vX.Y.Z a tag-ului");
  assert.match(text, /Tag invalid/, "respinge tag-urile care nu sunt semver");
  assert.match(text, /:latest/, "poate publica :latest");
  assert.match(text, /Pre-release.*fara :latest|fara :latest/, "pre-release-urile NU actualizeaza :latest");
  assert.match(text, /tags: \$\{\{ steps\.release\.outputs\.tags \}\}/, "tag-urile de imagine sunt calculate (stable -> +latest, pre-release -> doar tag)");
});

test("staging-smoke.yml scrie fisiere de rezultat si urca artifactul", () => {
  const text = read(stagingSmokeWorkflowPath);
  assert.match(text, /STAGING_SMOKE_RESULT_FILE:/, "seteaza fisierul de rezultat pentru proba HTTP");
  assert.match(text, /STAGING_DISCORD_SMOKE_RESULT_FILE:/, "seteaza fisierul de rezultat pentru proba Discord");
  assert.match(text, /actions\/upload-artifact@[0-9a-f]{40}/, "urca artifactul de rezultat (action pinuita pe SHA)");
  assert.match(text, /name: staging-smoke-result-\$\{\{ steps\.smokesha\.outputs\.sha \}\}/, "numele artifactului poarta SHA-ul real al codului testat");
  assert.match(text, /if: always\(\)/, "urca artifactul chiar si la esec, pentru audit");
});

test("staging-smoke.yml e rulabil pe un ref explicit, iar SHA-ul testat e cel din checkout", () => {
  const text = read(stagingSmokeWorkflowPath);
  assert.match(text, /workflow_dispatch:\s*\r?\n\s*inputs:/, "dispatch-ul are inputs");
  assert.match(text, /ref:\s*\r?\n/, "exista input-ul ref pentru tag/branch/SHA");
  assert.match(text, /ref: \$\{\{ inputs\.ref \|\| github\.ref \}\}/, "checkout-ul foloseste input-ul ref (fallback: ref-ul de dispatch/cron)");
  assert.match(text, /git rev-parse HEAD/, "SHA-ul testat e rezolvat din checkout-ul real, nu din head_sha al rularii");
});
