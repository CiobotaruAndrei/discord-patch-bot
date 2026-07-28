import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

import {
  AGENT_RULES_FILE,
  RULES_SOURCE,
  buildAgentRulesDocument,
  countRules,
  extractRuleBody,
  readRulesSource
} from "../../scripts/sync-agent-rules.js";

const repoRoot = path.resolve(process.cwd(), "..");

function readAgentRules(): string {
  return fs.readFileSync(path.join(repoRoot, AGENT_RULES_FILE), "utf8");
}

test("regulile ajung automat in contextul agentului, nu doar cand cineva le cere", () => {
  assert.ok(
    fs.existsSync(path.join(repoRoot, AGENT_RULES_FILE)),
    `${AGENT_RULES_FILE} e singurul loc citit automat la inceputul unei sesiuni; fara el, regulile se vad ` +
      `doar daca agentul isi aminteste sa deschida ${RULES_SOURCE}, ceea ce s-a dovedit ca nu se intampla`
  );
});

test("copia din context e identica cu sursa autoritara", () => {
  assert.equal(
    readAgentRules(),
    buildAgentRulesDocument(readRulesSource(repoRoot)),
    `${AGENT_RULES_FILE} a derapat fata de ${RULES_SOURCE}; ruleaza \`npm run rules:sync\`. ` +
      "O copie in urma e mai rea decat lipsa ei: agentul ar respecta increzator un set vechi de reguli"
  );
});

test("nicio regula nu se pierde pe drum", () => {
  const source = readRulesSource(repoRoot);
  const inSource = countRules(extractRuleBody(source));
  assert.ok(inSource >= 32, `sursa are ${inSource} reguli, sub cele 32 cunoscute`);
  assert.equal(countRules(readAgentRules()), inSource, "numarul de reguli difera intre sursa si copie");
});

test("copia nu inventeaza reguli proprii, fiindca regula 32 interzice asta", () => {
  const agent = readAgentRules();
  const body = extractRuleBody(readRulesSource(repoRoot));
  assert.ok(
    agent.endsWith(body),
    `${AGENT_RULES_FILE} trebuie sa se termine exact cu lista din ${RULES_SOURCE}; ` +
      "orice text de reguli adaugat dupa ea ar fi un set paralel, interzis de regula 32"
  );
});
