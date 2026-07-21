import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadYaraRuleset,
  scanWithYara,
  yaraIndicators,
  yaraRulesetInfo,
  type YaraScanReport
} from "../../features/command-security/yaraRuleset.js";
import { createThreatInspectionService } from "../../features/command-security/threatInspectionService.js";

const RULES = `
rule packer_cunoscut : packer {
  meta:
    severity = "high"
    description = "sablon de packer cunoscut"
  strings:
    $a = "UPX0"
  condition:
    $a
}

rule script_ofuscat {
  meta:
    severity = "medium"
    description = "script cu evaluare dinamica"
  strings:
    $a = "eval(base64_decode("
  condition:
    $a
}
`;

function withRulesDir(contents: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yara-rules-"));
  for (const [name, body] of Object.entries(contents)) fs.writeFileSync(path.join(dir, name), body, "utf8");
  return dir;
}

const engineAvailable = yaraRulesetInfo().available;

test("motorul YARA raporteaza onest cand nu este compilat sau cand nu are reguli", () => {
  const withoutPath = loadYaraRuleset(undefined);
  assert.equal(withoutPath.loaded, false, "fara YARA_RULES_PATH nu se incarca nimic");
  assert.equal(withoutPath.available, engineAvailable, "disponibilitatea motorului este raportata separat de incarcarea regulilor");
});

test("un set de reguli valid se incarca din director si isi raporteaza identitatea", { skip: !engineAvailable }, () => {
  const dir = withRulesDir({ "10-packer.yar": RULES });
  const info = loadYaraRuleset(dir);
  assert.equal(info.loaded, true);
  assert.equal(info.ruleCount, 2);
  assert.ok(info.rulesetId.length > 0, "ruleset-ul are un identificator pentru audit si cache key");
  assert.equal(yaraRulesetInfo().rulesetId, info.rulesetId);
});

test("un set de reguli invalid NU inlocuieste setul valid deja incarcat", { skip: !engineAvailable }, () => {
  const good = loadYaraRuleset(withRulesDir({ "10-packer.yar": RULES }));
  assert.equal(good.loaded, true);

  const logs: string[] = [];
  const broken = loadYaraRuleset(withRulesDir({ "20-stricat.yar": "rule stricat { condition: " }), (level, _context, message) => {
    logs.push(`${level}:${message}`);
  });
  assert.equal(broken.rulesetId, good.rulesetId, "setul anterior ramane activ");
  assert.ok(logs.some(entry => entry.startsWith("ERROR")), "esecul de incarcare e logat explicit");
});

test("un director fara fisiere de reguli este raportat ca eroare, nu ca set gol incarcat", { skip: !engineAvailable }, () => {
  const before = loadYaraRuleset(withRulesDir({ "10-packer.yar": RULES }));
  const empty = loadYaraRuleset(withRulesDir({ "citeste-ma.txt": "fara reguli aici" }));
  assert.equal(empty.rulesetId, before.rulesetId, "un director gol nu sterge setul activ");
});

test("scanarea raporteaza regula, tag-urile si metadata, fara sa produca vreun verdict", { skip: !engineAvailable }, async () => {
  loadYaraRuleset(withRulesDir({ "10-packer.yar": RULES }));
  const report = await scanWithYara(Buffer.from("stub cu UPX0 inauntru", "latin1"));
  assert.equal(report.status, "scanned");
  assert.equal(report.matches.length, 1);
  assert.equal(report.matches[0].rule, "packer_cunoscut");
  assert.deepEqual(report.matches[0].tags, ["packer"]);
  assert.equal(report.matches[0].severity, "high");
  assert.ok(report.rulesetId.length > 0, "raportul leaga potrivirea de versiunea ruleset-ului");
});

test("continutul curat este scanat si raportat explicit ca fara potriviri", { skip: !engineAvailable }, async () => {
  loadYaraRuleset(withRulesDir({ "10-packer.yar": RULES }));
  const report = await scanWithYara(Buffer.from("continut complet inofensiv", "latin1"));
  assert.equal(report.status, "scanned");
  assert.deepEqual(report.matches, []);
  assert.deepEqual(yaraIndicators(report), []);
});

test("indicatorii YARA sunt text descriptiv, nu verdicte", () => {
  const report: YaraScanReport = {
    status: "scanned",
    reason: "1 tipare YARA s-au potrivit",
    rulesetId: "abc123",
    matches: [{ rule: "packer_cunoscut", namespace: "default", tags: ["packer"], severity: "high", description: "sablon de packer cunoscut" }],
    truncated: false
  };
  const indicators = yaraIndicators(report);
  assert.equal(indicators.length, 1);
  assert.match(indicators[0], /regula YARA packer_cunoscut \(severitate high\)/);
  assert.ok(!indicators.some(entry => /confirmed|malware confirmat/i.test(entry)), "indicatorul nu pretinde niciodata confirmare");
});

test("potrivirile trunchiate sunt semnalate, nu pierdute tacit", () => {
  const indicators = yaraIndicators({
    status: "scanned",
    reason: "",
    rulesetId: "abc",
    matches: [{ rule: "r1", namespace: "default", tags: [], severity: "", description: "" }],
    truncated: true
  });
  assert.ok(indicators.some(entry => entry.includes("a depasit plafonul")));
});

test("un raport indisponibil sau eroare nu produce niciun indicator", () => {
  assert.deepEqual(yaraIndicators({ status: "unavailable", reason: "x", rulesetId: "", matches: [], truncated: false }), []);
  assert.deepEqual(yaraIndicators({ status: "error", reason: "x", rulesetId: "", matches: [], truncated: false }), []);
});

test("o potrivire YARA NU produce verdict confirmed: verdictul ramane pe motorul extern", { skip: !engineAvailable }, async () => {
  loadYaraRuleset(withRulesDir({ "10-packer.yar": RULES }));
  const inspector = createThreatInspectionService({
    httpReq: async () => ({
      data: Buffer.from("%PDF-1.7 document cu UPX0 in continut\n%%EOF\n", "latin1"),
      headers: { "content-type": "application/pdf" },
      status: 200
    })
  });

  const result = await inspector.inspectMessage("", [{ id: "a1", name: "raport.pdf", url: "https://cdn.example.test/raport.pdf" }]);

  assert.notEqual(result.verdict, "confirmed", "regulile locale nu pot confirma malware (PDF, sectiunea 6)");
  assert.equal(result.verdict, "uncertain");
  assert.match(result.reason, /regula YARA packer_cunoscut/);
  assert.match(result.reason, /confirmare/, "raspunsul spune explicit ca ramane necesara confirmarea externa");
});
