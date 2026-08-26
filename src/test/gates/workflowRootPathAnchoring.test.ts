import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const srcRoot = process.cwd();
const repoRoot = path.resolve(srcRoot, "..");
const workflowsDir = path.join(repoRoot, ".github", "workflows");

const ANCHORS = ["$GITHUB_WORKSPACE", "${GITHUB_WORKSPACE}", "github.workspace", "../", "$(git rev-parse --show-toplevel)"];

interface ShellLine {
  workflow: string;
  job: string;
  line: number;
  text: string;
}

function rootOnlyDirectories(): string[] {
  const inSrc = new Set(fs.readdirSync(srcRoot));
  return fs
    .readdirSync(repoRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== "src" && !inSrc.has(entry.name))
    .map(entry => entry.name);
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function shellLinesUnderNestedWorkingDirectory(workflow: string): ShellLine[] {
  const lines = fs.readFileSync(path.join(workflowsDir, workflow), "utf8").split("\n");
  const collected: ShellLine[] = [];
  let job = "";
  let jobIndent = -1;
  let nested = false;
  let stepOverride: string | null = null;
  let stepIndent = -1;
  let runIndent = -1;

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const indent = indentOf(line);

    if (runIndent >= 0) {
      if (indent > runIndent) {
        if (nested && stepOverride === null) collected.push({ workflow, job, line: index + 1, text: trimmed });
        continue;
      }
      runIndent = -1;
    }

    const jobHeader = /^(\s{2})([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (jobHeader) {
      job = jobHeader[2];
      jobIndent = indent;
      nested = false;
      stepOverride = null;
      stepIndent = -1;
      continue;
    }
    if (jobIndent < 0 || indent <= jobIndent) continue;

    if (trimmed.startsWith("- ")) {
      stepOverride = null;
      stepIndent = indent;
    } else if (stepIndent >= 0 && indent <= stepIndent) {
      stepOverride = null;
      stepIndent = -1;
    }

    const workingDirectory = /^working-directory:\s*(\S+)/.exec(trimmed);
    if (workingDirectory) {
      if (stepIndent >= 0) stepOverride = workingDirectory[1];
      else nested = workingDirectory[1] !== "." && !workingDirectory[1].includes("workspace");
      continue;
    }

    const inlineRun = /^(- )?run:\s*(\|-?|>-?)?\s*(.*)$/.exec(trimmed);
    if (inlineRun) {
      if (inlineRun[2]) runIndent = indent;
      else if (nested && stepOverride === null && inlineRun[3]) {
        collected.push({ workflow, job, line: index + 1, text: inlineRun[3] });
      }
    }
  }
  return collected;
}

function unanchoredReferences(line: ShellLine, directories: readonly string[]): string[] {
  if (ANCHORS.some(anchor => line.text.includes(anchor))) return [];
  return directories.filter(directory => new RegExp(`(^|[\\s"'=(:])${directory}/`).test(line.text));
}

test("un pas de shell dintr-un job cu working-directory imbricat nu citeste cai din radacina repo ca si cum ar fi relative", () => {
  const directories = rootOnlyDirectories();
  assert.ok(directories.length > 0, "fara directoare doar-in-radacina gate-ul nu ar verifica nimic");

  const offenders: string[] = [];
  for (const workflow of fs.readdirSync(workflowsDir).filter(name => name.endsWith(".yml") || name.endsWith(".yaml"))) {
    for (const line of shellLinesUnderNestedWorkingDirectory(workflow)) {
      for (const reference of unanchoredReferences(line, directories)) {
        offenders.push(`${line.workflow}:${line.line} (job ${line.job}) foloseste ${reference}/ fara ancorare: ${line.text}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "hashFiles() si `path:` se rezolva din radacina repo, dar comenzile de shell mostenesc working-directory-ul jobului; " +
      "o cale relativa scrisa ca in radacina pica abia in CI, cu 'No such file or directory'"
  );
});

test("lista comuna de pachete apt e citita cu o cale care exista din directorul in care ruleaza pasul", () => {
  for (const workflow of ["ci.yml", "native-sanitizers.yml"]) {
    const text = fs.readFileSync(path.join(workflowsDir, workflow), "utf8");
    const reads = text.split("\n").filter(line => line.includes("paste") && line.includes("native-apt-packages.txt"));
    assert.equal(reads.length, 1, `${workflow} trebuie sa citeasca lista de pachete exact o data`);
    assert.ok(
      ANCHORS.some(anchor => reads[0].includes(anchor)),
      `${workflow} ruleaza pasul din src/, deci lista din .github/workflows trebuie ancorata la radacina repo`
    );
  }
});
