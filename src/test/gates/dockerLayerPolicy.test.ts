import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const repoRoot = path.resolve(process.cwd(), "..");
const dockerfilePath = path.join(repoRoot, "Dockerfile");

interface Instruction {
  stage: string;
  keyword: string;
  args: string;
  line: number;
}

interface ExpensiveLayer {
  match: string;
  reason: string;
}

const EXPENSIVE_LAYERS: readonly ExpensiveLayer[] = [
  {
    match: "apt-get install -y --no-install-recommends ca-certificates build-essential",
    reason: "dependintele de compilare depind doar de imaginea de baza, deci stau primele si nu se reinstaleaza niciodata degeaba"
  },
  {
    match: "cargo build --release --target",
    reason: "aici se compileaza libyara, libarchive, qpdf si ZXing-C++; stratul depinde doar de manifestele cargo, ca un bump npm sa nu-l invalideze"
  },
  {
    match: "npm ci",
    reason: "depinde de package-lock.json, care se schimba saptamanal prin dependabot, deci vine dupa compilarea nativa"
  },
  {
    match: "npm run build:rust",
    reason: "recompileaza doar crate-urile din workspace peste dependintele deja construite mai sus"
  },
  {
    match: "npm run build:ts",
    reason: "are nevoie de tot arborele de surse, deci e ultimul pas scump din stage-ul de build"
  },
  {
    match: "apt-get install -y --no-install-recommends libssl3",
    reason: "librariile de rulare depind doar de imaginea de baza a stage-ului de runtime"
  },
  {
    match: "npm ci --omit=dev",
    reason: "instalarea de productie depinde de package-lock.json si nu are sub ea niciun pas de compilare"
  }
];

const EXPENSIVE_PATTERNS: readonly RegExp[] = [
  /\bcargo\s+(\+\S+\s+)?(build|install)\b/,
  /\bnpm (ci|install)\b/,
  /\bnpm run build\b/,
  /apt-get install\b/,
  /\b(cmake|make|pip install)\b/
];

function parseInstructions(): Instruction[] {
  const raw = fs.readFileSync(dockerfilePath, "utf8").split("\n");
  const instructions: Instruction[] = [];
  let stage = "(fara stage)";
  let buffer = "";
  let bufferLine = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const line = raw[index];
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.length === 0) continue;
    if (buffer.length === 0) bufferLine = index + 1;
    buffer += (buffer.length > 0 ? " " : "") + trimmed.replace(/\\$/, "").trim();
    if (trimmed.endsWith("\\")) continue;
    const match = /^(\w+)\s+([\s\S]*)$/.exec(buffer);
    buffer = "";
    if (!match) continue;
    const keyword = match[1].toUpperCase();
    const args = match[2].trim();
    if (keyword === "FROM") {
      const named = /\sAS\s+(\S+)/i.exec(args);
      stage = named ? named[1] : args.split(/\s+/)[0];
    }
    instructions.push({ stage, keyword, args, line: bufferLine });
  }
  return instructions;
}

function isExpensive(args: string): boolean {
  return EXPENSIVE_PATTERNS.some(pattern => pattern.test(args));
}

function contextSources(args: string): string[] {
  if (/^--from=/.test(args)) return [];
  const parts = args.replace(/^(--\S+\s+)*/, "").split(/\s+/);
  return parts.slice(0, -1);
}

function coveredPrefix(source: string): string {
  return source.endsWith("/") ? source : `${source}/`;
}

function isStrictlyNarrower(candidate: string, previous: string): boolean {
  const candidatePrefix = coveredPrefix(candidate);
  const previousPrefix = coveredPrefix(previous);
  return candidatePrefix !== previousPrefix && candidatePrefix.startsWith(previousPrefix);
}

const instructions = parseInstructions();

test("fiecare pas scump din Dockerfile e declarat, cu motivul pozitiei lui", () => {
  const declared = EXPENSIVE_LAYERS.map(entry => entry.match);
  const undeclared: string[] = [];
  for (const instruction of instructions) {
    if (instruction.keyword !== "RUN" || !isExpensive(instruction.args)) continue;
    if (declared.some(match => instruction.args.includes(match))) continue;
    undeclared.push(`linia ${instruction.line}: ${instruction.args.slice(0, 70)}`);
  }
  assert.deepEqual(
    undeclared,
    [],
    "un pas scump nou trebuie trecut in EXPENSIVE_LAYERS cu motivul pentru care sta unde sta. " +
      `Pozitia decide ce il invalideaza, iar tacerea a costat deja 290-340s per build: ${undeclared.join(" | ")}`
  );
});

test("nu raman declarate straturi scumpe care au disparut din Dockerfile", () => {
  for (const entry of EXPENSIVE_LAYERS) {
    assert.ok(
      instructions.some(instruction => instruction.keyword === "RUN" && instruction.args.includes(entry.match)),
      `${entry.match} nu mai exista in Dockerfile; o intrare invechita face lista de neincrezut`
    );
    assert.ok(entry.reason.length >= 40, `${entry.match} e declarat fara un motiv verificabil al pozitiei`);
  }
});

test("in acelasi stage, un COPY din context nu se ingusteaza dupa unul mai larg", () => {
  const violations: string[] = [];
  const seenByStage = new Map<string, string[]>();
  for (const instruction of instructions) {
    if (instruction.keyword !== "COPY") continue;
    const sources = contextSources(instruction.args);
    if (sources.length === 0) continue;
    const seen = seenByStage.get(instruction.stage) ?? [];
    for (const source of sources) {
      for (const previous of seen) {
        if (!isStrictlyNarrower(source, previous)) continue;
        violations.push(`linia ${instruction.line}: ${source} e mai ingust decat ${previous}, copiat mai devreme`);
      }
    }
    seenByStage.set(instruction.stage, [...seen, ...sources]);
  }
  assert.deepEqual(
    violations,
    [],
    "dupa ce un arbore larg a fost copiat, tot ce urmeaza se invalideaza la orice fisier din el; " +
      `un COPY mai ingust de dupa inseamna ca un pas scump asteapta degeaba dupa surse care nu-l privesc: ${violations.join(" | ")}`
  );
});

test("stratul de pre-compilare a dependintelor acopera fiecare membru al workspace-ului", () => {
  const workspace = fs.readFileSync(path.join(process.cwd(), "native", "Cargo.toml"), "utf8");
  const declarati = workspace.match(/members\s*=\s*\[([^\]]*)\]/);
  assert.ok(declarati, "workspace-ul native trebuie sa declare explicit membrii");

  const membri = [...declarati[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  assert.ok(membri.length > 0, "o lista goala ar face verificarea asta fara efect");

  const dockerfile = fs.readFileSync(path.join(process.cwd(), "..", "Dockerfile"), "utf8");
  const lipsa = membri.filter(membru => !dockerfile.includes(`native/${membru}/Cargo.toml`));

  assert.deepEqual(
    lipsa,
    [],
    "stratul care pre-compileaza dependintele Rust construieste `--workspace`, deci cargo cere manifestul " +
      "fiecarui membru; unul lipsa opreste build-ul imaginii cu `failed to load manifest`, iar asta se vede " +
      `abia in CI, dupa push. Membri fara COPY in Dockerfile: ${lipsa.join(", ")}`
  );
});
