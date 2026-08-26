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

const FALSY_LITERALS = new Set(["false", "0", "''", "\"\"", "null", ""]);

function truthy(value: string): boolean {
  return !FALSY_LITERALS.has(value.trim());
}

function evaluateGithubExpression(expression: string, eventName: string): string {
  const inner = expression.trim().replace(/^\$\{\{/, "").replace(/\}\}$/, "").trim();
  const terms = inner.split("||").map(term => term.trim());
  let result = "";
  for (const [index, term] of terms.entries()) {
    const operands = term.split("&&").map(operand => operand.trim());
    let value = "";
    for (const [position, operand] of operands.entries()) {
      const comparison = /^github\.event_name\s*(==|!=)\s*'([^']*)'$/.exec(operand);
      value = comparison
        ? String(comparison[1] === "==" ? eventName === comparison[2] : eventName !== comparison[2])
        : operand;
      if (!truthy(value) && position < operands.length - 1) break;
    }
    result = value;
    if (truthy(value) || index === terms.length - 1) break;
  }
  return truthy(result) ? result.replace(/^'|'$/g, "") : "";
}

test("evaluatorul reproduce semantica GitHub, in care sirul gol e falsy", () => {
  assert.equal(
    evaluateGithubExpression("${{ github.event_name == 'pull_request' && '' || 'export' }}", "pull_request"),
    "export",
    "forma `este_PR && '' || valoare` pare sa opreasca exportul, dar sirul gol e falsy si `||` cade pe valoare"
  );
  assert.equal(evaluateGithubExpression("${{ github.event_name != 'pull_request' && 'export' || '' }}", "pull_request"), "");
  assert.equal(evaluateGithubExpression("${{ github.event_name != 'pull_request' && 'export' || '' }}", "push"), "export");
});

test("exportul de layere Docker nu se face din PR-uri", () => {
  const source = workflow("container-scan.yml");
  const cacheTo = source.split("\n").find(line => line.trim().startsWith("cache-to:"));
  assert.ok(cacheTo, "workflow-ul declara un cache-to");
  const expression = cacheTo.slice(cacheTo.indexOf("cache-to:") + "cache-to:".length).trim();

  assert.equal(
    evaluateGithubExpression(expression, "pull_request"),
    "",
    "`mode=max` scrie fiecare layer intermediar ca intrare separata, iar un PR isi are propriul scope de cache: " +
      "daca expresia se EVALUEAZA la un export, fiecare PR duplica intreg setul si repo-ul depaseste cota de 10 GB, " +
      "moment in care GitHub evacueaza LRU exact layerele necesare rularii urmatoare. Verificarea evalueaza " +
      "expresia, nu cauta un sir in ea: forma inversata contine aceeasi comparatie dar exporta din PR-uri"
  );
  assert.match(
    evaluateGithubExpression(expression, "push"),
    /type=gha/,
    "de pe main cache-ul TREBUIE exportat, altfel nicio rulare nu mai gaseste layere si build-ul ramane mereu rece"
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

test("o trecere programata prinde cache-urile scrise dupa inchiderea PR-ului", () => {
  const source = workflow("cache-cleanup.yml");
  assert.match(
    source,
    /schedule:\s*\n\s*-\s*cron:/,
    "curatarea la inchidere pierde cursa cu o rulare inca in derulare, care exporta cache dupa ce stergerea a terminat"
  );
  assert.match(
    source,
    /state.*!=.*MERGED|MERGED.*state/s,
    "trecerea sterge doar cache-urile PR-urilor inchise; unul deschis inca isi foloseste cache-ul"
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
      const expression = trimmed.slice("cache-to:".length).trim();
      if (!expression.startsWith("${{")) {
        offenders.push(`${name}:${index + 1}`);
        continue;
      }
      if (evaluateGithubExpression(expression, "pull_request") !== "") offenders.push(`${name}:${index + 1}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "un cache-to care se evalueaza la un export intr-un workflow care ruleaza pe PR-uri inseamna ca fiecare PR isi " +
      `scrie propria copie a cache-ului; asa s-a ajuns la 11,4 GB fata de cota de 10 GB (${offenders.join(", ")})`
  );
});

test("niciun actions/cache dintr-un workflow de PR nu scrie neconditionat", () => {
  const offenders: string[] = [];

  for (const name of workflowNames()) {
    const source = workflow(name);
    if (!source.includes("pull_request")) continue;

    const lines = source.split("\n");
    for (const [index, line] of lines.entries()) {
      if (!line.includes("uses: actions/cache@")) continue;
      const step = lines.slice(Math.max(0, index - 6), index + 8).join("\n");
      if (!step.includes("if:") || !step.includes("refs/heads/main")) offenders.push(`${name}:${index + 1}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "`actions/cache` salveaza la finalul jobului, deci intr-un workflow de PR fiecare branch isi scrie propria copie. "
      + "Foloseste `actions/cache/restore` plus un `actions/cache/save` conditionat pe main, ca la cache-ul de pachete apt "
      + `(${offenders.join(", ")})`
  );
});

test("pachetele apt native sunt intr-o singura lista, folosita de toate workflow-urile", () => {
  const listPath = "native-apt-packages.txt";
  const users = workflowNames().filter(name => workflow(name).includes("libclang-dev") || workflow(name).includes(listPath));

  assert.ok(users.length > 0, "lista de pachete native trebuie sa fie folosita de cel putin un workflow");
  const withoutList = users.filter(name => !workflow(name).includes(listPath));

  assert.deepEqual(
    withoutList,
    [],
    "o a doua lista de pachete scrisa inline ar diverge tacut de cheia de cache si ar reinstala de la zero"
  );
});

test("instalarea pastreaza arhivele .deb, altfel cache-ul salvat ar fi gol", () => {
  const installers = workflowNames().filter(name => /apt-get[^\n]*install/.test(workflow(name)));
  assert.ok(installers.length > 0, "cel putin un workflow instaleaza pachete native prin apt-get");

  const discarding = installers.filter(name => {
    const text = workflow(name);
    if (!text.includes("apt-archives")) return false;
    return !text.includes("APT::Keep-Downloaded-Packages=true");
  });

  assert.deepEqual(
    discarding,
    [],
    "apt sterge implicit arhivele descarcate dupa instalare; fara optiune, pasul care copiaza in ~/apt-archives " +
      "ar salva un cache gol si fiecare rulare ar descarca din nou toate pachetele, fara niciun semnal ca ceva e in neregula"
  );
});
