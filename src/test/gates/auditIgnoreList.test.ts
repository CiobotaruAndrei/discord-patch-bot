import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const srcRoot = process.cwd();
const repoRoot = path.resolve(srcRoot, "..");
const workflowPath = path.join(repoRoot, ".github", "workflows", "dependency-audit.yml");

const ACCEPTED_ADVISORIES = ["RUSTSEC-2024-0436"];

function readWorkflow(): string {
  return fs.readFileSync(workflowPath, "utf8");
}

test("lista de avize ignorate la audit e exact cea acceptata, nu creste tacut", () => {
  const workflow = readWorkflow();
  const ignored = Array.from(workflow.matchAll(/--ignore\s+(RUSTSEC-[0-9]{4}-[0-9]{4})/g)).map(match => match[1]);
  assert.deepEqual(
    ignored,
    ACCEPTED_ADVISORIES,
    "fiecare aviz ignorat trebuie sa fie o decizie constienta: adaugarea unuia nou cere si actualizarea acestui test, cu motivul scris in workflow"
  );
});

test("fiecare aviz ignorat are motivul scris langa pasul de audit", () => {
  const workflow = readWorkflow();
  for (const advisory of ACCEPTED_ADVISORIES) {
    assert.ok(
      workflow.includes(advisory),
      `${advisory} apare in workflow`
    );
  }
  assert.match(
    workflow,
    /proc-macro care ruleaza DOAR la compilare/,
    "motivul exceptiei e explicat in workflow, nu doar in istoricul de commit-uri"
  );
});

test("auditul ramane strict: warning-urile pica in continuare, exceptia nu slabeste poarta", () => {
  const workflow = readWorkflow();
  assert.match(workflow, /cargo audit .*--deny warnings/, "politica --deny warnings ramane activa");
  assert.match(workflow, /npm audit --omit=dev --audit-level=moderate/, "auditul npm ramane neschimbat");
});
