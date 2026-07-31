import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const repoRoot = path.resolve(process.cwd(), "..");
const workflowsDir = path.join(repoRoot, ".github", "workflows");

function workflow(name: string): string {
  return fs.readFileSync(path.join(workflowsDir, name), "utf8");
}

function workflowNames(): string[] {
  return fs.readdirSync(workflowsDir).filter(name => name.endsWith(".yml"));
}

test("exportul de layere Docker nu se face din PR-uri", () => {
  const source = workflow("container-scan.yml");
  const cacheTo = source.split("\n").find(line => line.trim().startsWith("cache-to:"));
  assert.ok(cacheTo, "workflow-ul declara un cache-to");
  assert.match(
    cacheTo,
    /github\.event_name\s*==\s*'pull_request'/,
    "`mode=max` scrie fiecare layer intermediar ca intrare separata, iar un PR isi are propriul scope de cache: " +
      "fara conditie, fiecare PR duplica intreg setul si repo-ul depaseste cota de 10 GB, moment in care GitHub " +
      "evacueaza LRU exact layerele necesare rularii urmatoare"
  );
  assert.match(source, /cache-from:\s*type=gha/, "citirea ramane deschisa tuturor branch-urilor");
});

test("cache-ul Rust se salveaza doar de pe main", () => {
  const source = workflow("ci.yml");
  assert.match(
    source,
    /save-if:\s*\$\{\{\s*github\.ref\s*==\s*'refs\/heads\/main'\s*\}\}/,
    "intrarea are ~400 MB; salvata de pe fiecare branch, ajunge la cateva GB din cota si scoate afara restul cache-urilor"
  );
});

test("cache-urile unui PR se sterg cand PR-ul se inchide", () => {
  const source = workflow("cache-cleanup.yml");
  assert.match(source, /types:\s*\n\s*-\s*closed/, "curatarea se declanseaza la inchiderea PR-ului");
  assert.match(source, /actions:\s*write/, "stergerea cere permisiune de scriere pe Actions");
  assert.match(source, /actions\/caches\/\$id/, "sterge intrarile prin API-ul de cache");
  assert.match(
    source,
    /head\.repo\.full_name\s*==\s*github\.repository/,
    "un PR din fork primeste token read-only, deci jobul se sare in loc sa esueze"
  );
});

test("niciun workflow nu scrie cache neconditionat dintr-un context de PR", () => {
  const offenders: string[] = [];
  for (const name of workflowNames()) {
    const source = workflow(name);
    if (!source.includes("pull_request")) continue;
    for (const [index, line] of source.split("\n").entries()) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("cache-to:")) continue;
      if (trimmed.includes("github.event_name") || trimmed.includes("github.ref")) continue;
      offenders.push(`${name}:${index + 1}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "un cache-to neconditionat intr-un workflow care ruleaza pe PR-uri inseamna ca fiecare PR isi scrie propria " +
      `copie a cache-ului; asa s-a ajuns la 11,4 GB fata de cota de 10 GB (${offenders.join(", ")})`
  );
});
