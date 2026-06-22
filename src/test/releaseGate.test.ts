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

test("release.yml ruleaza check:full (CI + native + e2e), iar check:full include test:e2e (review manual P2 #1)", () => {
  const text = read(releaseWorkflowPath);
  assert.match(text, /run: npm run check:full/, "release-ul ruleaza check:full, deci si E2E (nu doar npm run check, cum era inainte)");
  const pkg = JSON.parse(read(path.join(srcRoot, "package.json"))) as { scripts: Record<string, string> };
  assert.match(pkg.scripts["check:full"], /\btest:e2e\b/, "check:full include test:e2e — E2E ruleaza la release, nu doar pe CI-ul de PR");
  assert.match(pkg.scripts["check:full"], /\bcheck:native\b/, "check:full include si validarea Rust (clippy + cargo test)");
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
  assert.match(text, /c\.name === "send"/, "cere explicit check-ul send in JSON-ul Discord (review #15.1)");
  assert.match(text, /!sendCheck \|\| !sendCheck\.ok/, "respinge artifactul fara proba reala de trimitere reusita");
});

test("staging-smoke.yml activeaza implicit testul real de trimitere, iar scriptul izoleaza esecul send-ului (review #15.1)", () => {
  const text = read(stagingSmokeWorkflowPath);
  assert.match(text, /STAGING_DISCORD_SEND_TEST: \$\{\{ secrets\.STAGING_DISCORD_SEND_TEST \|\| 'true' \}\}/,
    "send test-ul e implicit pornit; secretul poate doar sa-l opreasca explicit");
  const script = fs.readFileSync(path.join(srcRoot, "scripts", "stagingDiscordSmoke.ts"), "utf8");
  assert.match(script, /name: "send", ok: false, detail: `trimiterea\/stergerea reala a esuat/,
    "esecul lui send\/delete adauga check-ul send esuat, nu cade in catch-ul de permissions");
});

test("release.yml valideaza semver si publica :latest doar pentru release-uri stabile", () => {
  const text = read(releaseWorkflowPath);
  assert.match(text, /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+/, "valideaza forma semver vX.Y.Z a tag-ului");
  assert.match(text, /Tag invalid/, "respinge tag-urile care nu sunt semver");
  assert.match(text, /:latest/, "poate publica :latest");
  assert.match(text, /Pre-release.*fara :latest|fara :latest/, "pre-release-urile NU actualizeaza :latest");
  assert.match(text, /RELEASE_TAGS: \$\{\{ steps\.release\.outputs\.tags \}\}/, "tag-urile de imagine sunt calculate (stable -> +latest, pre-release -> doar tag) si ajung la pasul de publish");
});

test("release.yml scaneaza cu Trivy exact imaginea pe care o publica, inainte de push (review #8.1)", () => {
  const text = read(releaseWorkflowPath);
  assert.match(text, /aquasecurity\/trivy-action@[0-9a-f]{40}/, "Trivy ruleaza in release (action pinuita pe SHA)");
  assert.match(text, /push: false/, "imaginea se construieste local, nu se publica direct");
  assert.match(text, /load: true/, "imaginea e incarcata in daemon pentru scanare");
  assert.ok(!/push: true/.test(text), "niciun build-push direct care sa ocoleasca gate-ul Trivy");
  assert.match(text, /exit-code: "1"/, "gate-ul Trivy e blocant");
  assert.match(text, /severity: CRITICAL,HIGH/, "gate-ul acopera CRITICAL/HIGH");
  assert.match(text, /ignore-unfixed: true/, "gate-ul blocheaza doar vulnerabilitatile fixabile (paritate cu container-scan.yml)");
  assert.match(text, /docker tag "\$SCAN_IMAGE" "\$tag"/, "tag-urile de release se aplica pe imaginea scanata");
  assert.match(text, /docker push "\$tag"/, "push-ul publica exact bytes-ii scanati, fara rebuild");
  const scanIdx = text.indexOf("Trivy gate pe imaginea exacta");
  const pushIdx = text.indexOf("docker push");
  assert.ok(scanIdx >= 0 && pushIdx > scanIdx, "scanarea Trivy e inaintea push-ului");
});

test("release.yml ruleaza canary:sources live pe codul tag-ului, inainte de publicare (review #8.2)", () => {
  const text = read(releaseWorkflowPath);
  assert.match(text, /npm run canary:sources/, "release-ul cere un canary live pe surse");
  const checkoutIdx = text.indexOf("Checkout release ref");
  const canaryIdx = text.indexOf("npm run canary:sources");
  const publishIdx = text.indexOf("Publish scanned image");
  assert.ok(checkoutIdx >= 0 && canaryIdx > checkoutIdx, "canary-ul ruleaza pe checkout-ul tag-ului, nu pe ref-ul de dispatch");
  assert.ok(publishIdx > canaryIdx, "canary-ul ruleaza inainte de publicarea imaginii");
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

test("staging-smoke.yml ruleaza saptamanal (schedule cron) + la cerere, consistent cu README", () => {
  const text = read(stagingSmokeWorkflowPath);
  assert.match(text, /schedule:\s*\r?\n\s*- cron: "0 8 \* \* 1"/, "staging-smoke are un trigger schedule saptamanal (luni), nu doar workflow_dispatch");
  assert.match(text, /workflow_dispatch:/, "staging-smoke se poate rula si la cerere");

  const readme = read(path.join(repoRoot, "README.md"));
  const stagingLine = readme.split("\n").find(line => line.includes("`Staging Smoke`") && line.includes("staging-smoke.yml")) || "";
  assert.ok(stagingLine, "README descrie workflow-ul Staging Smoke");
  assert.match(stagingLine, /saptaman/i, "README descrie corect cadenta saptamanala (workflow-ul ARE schedule cron, nu doar workflow_dispatch)");
  assert.match(stagingLine, /la cerere|workflow_dispatch/, "README mentioneaza si rularea la cerere");
});

test("release.yml pagineaza rularile Staging Smoke (nu doar prima pagina) pana la fereastra de varsta", () => {
  const text = read(releaseWorkflowPath);
  assert.match(text, /per_page: 100/, "pagini pline, nu 50 fara paginare");
  assert.match(text, /page <= MAX_PAGES|for \(let page = 1/, "itereaza paginile de rulari");
  assert.match(text, /^\s+page\r?$/m, "parametrul page e trimis catre listWorkflowRuns");
  assert.match(text, /oldest|created_at/, "se opreste cand rularile devin mai vechi decat fereastra, nu citeste la nesfarsit");
});

test("staging-smoke.yml ruleaza ambele probe independent si da verdictul din JSON-urile de rezultat", () => {
  const text = read(stagingSmokeWorkflowPath);
  const probeIfCount = (text.match(/if: \$\{\{ !cancelled\(\) \}\}/g) || []).length;
  assert.ok(probeIfCount >= 3, "ambele probe + verdictul ruleaza cu if: !cancelled() (proba Discord nu mai e sarita cand pica HTTP-ul)");
  assert.match(text, /Final verdict/, "exista pasul de verdict final");
  assert.match(text, /HTTP_RESULT_FILE/, "verdictul citeste rezultatul probei HTTP");
  assert.match(text, /DISCORD_RESULT_FILE/, "verdictul citeste rezultatul probei Discord");
  assert.match(text, /!result\.ok/, "verdictul pica job-ul pe ok=false din JSON");
  assert.match(text, /result\.skipped/, "verdictul standalone detecteaza rezultatele sarite (skipped=true), nu le lasa sa treaca tacut ca verde");
  assert.match(text, /::warning::\[staging-smoke\][^\n]*SARIT/, "verdictul emite un warning vizibil cand o proba a fost sarita, ca verde-le job-ului sa nu para o proba live reala");
});
