import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const repoRoot = path.resolve(process.cwd(), "..");
const workflowsDir = path.join(repoRoot, ".github", "workflows");

interface ReuseWaiver {
  workflow: string;
  reason: string;
}

const REUSE_WAIVERS: readonly ReuseWaiver[] = [
  {
    workflow: "release.yml",
    reason:
      "artefactul publicat trebuie sa vina din sursa tag-ului, nu din straturi dintr-un cache mutabil; " +
      "aici castigul se ia din a nu construi de doua ori, nu din cache"
  }
];

const EXPENSIVE_PATTERNS: readonly RegExp[] = [
  /cargo\s+(\+\S+\s+)?(build|test|clippy|install)\b/,
  /npm run (check|build)/,
  /docker\/build-push-action/
];

const REUSE_PATTERNS: readonly RegExp[] = [
  /Swatinem\/rust-cache@/,
  /actions\/cache@/,
  /cache-from:/,
  /^\s*cache:\s*\S/m
];

function workflowFiles(): string[] {
  return fs.readdirSync(workflowsDir).filter(name => name.endsWith(".yml") || name.endsWith(".yaml"));
}

function activeText(file: string): string {
  return fs
    .readFileSync(path.join(workflowsDir, file), "utf8")
    .split("\n")
    .filter(line => !line.trim().startsWith("#"))
    .join("\n");
}

function isExpensive(text: string): boolean {
  return EXPENSIVE_PATTERNS.some(pattern => pattern.test(text));
}

function declaresReuse(text: string): boolean {
  return REUSE_PATTERNS.some(pattern => pattern.test(text));
}

test("orice workflow care compileaza ceva scump declara ce face cu reutilizarea", () => {
  const waived = new Set(REUSE_WAIVERS.map(entry => entry.workflow));
  const undecided: string[] = [];
  for (const file of workflowFiles()) {
    const text = activeText(file);
    if (!isExpensive(text) || declaresReuse(text) || waived.has(file)) continue;
    undecided.push(file);
  }
  assert.deepEqual(
    undecided,
    [],
    `${undecided.join(", ")} compileaza cod nativ sau construieste o imagine fara sa spuna nimic despre reutilizare. ` +
      "Adauga un cache, sau treci workflow-ul in REUSE_WAIVERS cu motivul pentru care refuzi cache-ul. " +
      "Tacerea a costat deja: libyara, libarchive, qpdf si ZXing-C++ s-au recompilat la fiecare bump de npm."
  );
});

test("fiecare derogare de la cache are un motiv scris, nu doar un nume de fisier", () => {
  for (const waiver of REUSE_WAIVERS) {
    assert.ok(
      fs.existsSync(path.join(workflowsDir, waiver.workflow)),
      `${waiver.workflow} nu mai exista; o derogare pentru un workflow disparut ascunde urmatorul caz real`
    );
    assert.ok(
      waiver.reason.length >= 40,
      `${waiver.workflow} refuza cache-ul fara un motiv verificabil scris`
    );
  }
});

test("o derogare pentru un workflow care intre timp cache-uieste este respinsa ca invechita", () => {
  for (const waiver of REUSE_WAIVERS) {
    assert.equal(
      declaresReuse(activeText(waiver.workflow)),
      false,
      `${waiver.workflow} are si cache si derogare; una dintre ele minte, iar lista de exceptii trebuie sa ramana citibila`
    );
  }
});

test("comenzile cargo din workflow-uri poarta tripletul, ca sa nu compileze paralel cu napi", () => {
  const offenders: string[] = [];
  for (const file of workflowFiles()) {
    for (const line of activeText(file).split("\n")) {
      if (!/cargo\s+(\+\S+\s+)?(build|test|clippy)\b/.test(line)) continue;
      if (line.includes("--target")) continue;
      offenders.push(`${file}: ${line.trim()}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "napi build compileaza in target/<triplet>/release; o comanda cargo fara --target scrie in target/release " +
      `si recompila de la zero acelasi set de librarii C/C++: ${offenders.join(" | ")}`
  );
});

test("scripturile npm nu cheama cargo direct, ca alinierea tripletului sa nu poata fi ocolita", () => {
  const packageJson = fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8");
  const parsed = JSON.parse(packageJson) as { scripts: Record<string, string> };
  const offenders = Object.entries(parsed.scripts)
    .filter(([, value]) => /cargo\s+(build|test|clippy)\b/.test(value))
    .map(([name]) => name);
  assert.deepEqual(
    offenders,
    [],
    `${offenders.join(", ")} cheama cargo direct; validarea nativa trece prin scripts/check-native.ts, ` +
      "care citeste tripletul din rustc -vV si il transmite mai departe"
  );
});
