import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const srcRoot = process.cwd();
const repoRoot = path.resolve(srcRoot, "..");
const workflowsDir = path.join(repoRoot, ".github", "workflows");

interface ActionReference {
  workflow: string;
  action: string;
  sha: string;
}

function collectCodeqlReferences(): ActionReference[] {
  const references: ActionReference[] = [];
  for (const file of fs.readdirSync(workflowsDir)) {
    if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
    const text = fs.readFileSync(path.join(workflowsDir, file), "utf8");
    for (const match of text.matchAll(/github\/(codeql-action\/[a-z-]+)@([0-9a-f]{40})/g)) {
      references.push({ workflow: file, action: match[1], sha: match[2] });
    }
  }
  return references;
}

test("toate actiunile codeql-action sunt fixate pe acelasi commit, in toate workflow-urile", () => {
  const references = collectCodeqlReferences();
  assert.ok(references.length >= 3, `codeql-action e folosita in mai multe workflow-uri, gasite ${references.length} referinte`);

  const shas = new Set(references.map(entry => entry.sha));
  assert.equal(
    shas.size,
    1,
    `init, analyze si upload-sarif sunt parti ale aceleiasi versiuni si esueaza cu "Loaded a configuration file for version X, but running version Y" daca difera; referinte gasite: ${references.map(entry => `${entry.workflow}:${entry.action}@${entry.sha.slice(0, 8)}`).join(", ")}`
  );
});

test("actiunile codeql-action sunt fixate pe commit, nu pe eticheta mobila", () => {
  for (const file of fs.readdirSync(workflowsDir)) {
    if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
    const text = fs.readFileSync(path.join(workflowsDir, file), "utf8");
    for (const match of text.matchAll(/github\/codeql-action\/[a-z-]+@(\S+)/g)) {
      assert.match(
        match[1],
        /^[0-9a-f]{40}$/,
        `${file} refera codeql-action printr-o eticheta mobila (${match[1]}); pinning-ul pe commit e cerinta de supply chain`
      );
    }
  }
});

test("grupul dependabot pentru codeql-action exista, ca bump-urile sa vina impreuna", () => {
  const config = fs.readFileSync(path.join(repoRoot, ".github", "dependabot.yml"), "utf8");
  assert.match(
    config,
    /codeql-action:\s*\n\s*patterns:\s*\n\s*-\s*"github\/codeql-action\*"/,
    "fara grup, dependabot deschide cate un PR per actiune, iar fiecare PR singur are versiuni amestecate si pica"
  );
});
