import test from "node:test";
import assert from "node:assert/strict";

import { spawnSync } from "child_process";
import path from "path";
import { pathToFileURL } from "node:url";

const srcRoot = process.cwd();
const repoRoot = path.resolve(srcRoot, "..");

interface Classifiers {
  isCode: (file: string) => boolean;
  isDoc: (file: string) => boolean;
  isTest: (file: string) => boolean;
  isInfra: (file: string) => boolean;
}

const classifiersPath = path.join(repoRoot, ".github", "scripts", "pr-checklist-file-classifiers.js");
const { isCode, isDoc, isTest, isInfra } = ((await import(pathToFileURL(classifiersPath).href)) as { default: Classifiers }).default;

function changedFiles(): string[] | undefined {
  const base = spawnSync("git", ["merge-base", "HEAD", "origin/main"], { cwd: repoRoot, encoding: "utf8" });
  if (base.status !== 0) return undefined;
  const diff = spawnSync("git", ["diff", "--name-only", base.stdout.trim(), "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  if (diff.status !== 0) return undefined;
  return diff.stdout.split("\n").map(line => line.trim()).filter(line => line.length > 0);
}

test("un diff care atinge cod atinge si documentatie si teste, ca la CI", () => {
  const files = changedFiles();
  if (files === undefined || files.length === 0) {
    return;
  }

  const problems: string[] = [];
  if (files.some(isCode) && !files.some(isDoc)) {
    problems.push("diff-ul atinge cod (src/**) dar niciun fisier de documentatie (.md)");
  }
  if (files.some(isCode) && !files.some(isTest)) {
    problems.push(
      "diff-ul atinge cod (src/**) dar niciun fisier de test din src/test/**; " +
        "testele din native/core/tests nu satisfac clasificatorul"
    );
  }
  if (files.some(isInfra) && !files.some(isDoc)) {
    problems.push("diff-ul atinge infrastructura dar niciun fisier de documentatie (.md)");
  }

  assert.deepEqual(
    problems,
    [],
    `${problems.join(" | ")}. Aceleasi reguli ruleaza in pr-checklist.yml; gate-ul asta le aduce inainte de push, ` +
      "fiindca aceeasi ratare s-a repetat de patru ori intr-o singura sesiune"
  );
});
