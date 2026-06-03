import test from "node:test";
import assert from "node:assert/strict";

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");

const srcRoot = process.cwd();
const repoRoot = path.resolve(srcRoot, "..");
const readmePath = path.join(repoRoot, "README.md");
const workflowPath = path.join(repoRoot, ".github", "workflows", "staging-smoke.yml");

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

test("README documenteaza smoke-ul de staging semi-automat (ambele runner-e + guild de test)", () => {
  const text = read(readmePath);
  assert.match(text, /smoke:staging\b/, "documenteaza proba HTTP de staging");
  assert.match(text, /smoke:staging:discord/, "documenteaza proba live Discord");
  assert.match(text, /STAGING_TEST_GUILD_ID/, "mentioneaza guild-ul de test");
  assert.match(text, /staging-smoke\.yml|Staging Smoke/, "trimite la workflow-ul de staging");
  assert.match(text, /STAGING_SMOKE\.md/, "pastreaza checklist-ul manual pentru ce nu se automatizeaza");
});

test("workflow-ul Staging Smoke ruleaza ambele probe cu secretele de test guild", () => {
  const text = read(workflowPath);
  assert.match(text, /npm run smoke:staging\b/, "ruleaza proba HTTP");
  assert.match(text, /npm run smoke:staging:discord/, "ruleaza proba live Discord");
  for (const secret of ["STAGING_DISCORD_TOKEN", "STAGING_DISCORD_CLIENT_ID", "STAGING_TEST_GUILD_ID", "STAGING_TEST_CHANNEL_ID"]) {
    assert.match(text, new RegExp(secret), `trece secretul ${secret}`);
  }
});
