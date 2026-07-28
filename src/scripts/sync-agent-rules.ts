import fs from "node:fs";
import path from "node:path";

export const RULES_SOURCE = path.join("docs", "Reguli de respectat.md");
export const AGENT_RULES_FILE = "CLAUDE.md";

const PREAMBLE = [
  "# Instructiuni pentru agentii care lucreaza in acest repo",
  "",
  "Acest fisier exista dintr-un singur motiv: regulile repo-ului traiau doar in `docs/Reguli de respectat.md`,",
  "deci un agent le vedea numai daca isi amintea sa le caute. Sunt copiate mai jos ca sa fie in context de la",
  "primul mesaj al fiecarei sesiuni, fara ca cineva sa trebuiasca sa le ceara.",
  "",
  "**Sursa autoritara ramane `docs/Reguli de respectat.md`.** Blocul de mai jos este o copie identica, nu un set",
  "paralel de reguli, si nu adauga nimic la ele: regula 32 spune ca doar regulile din fisierul acela exista pentru",
  "acest repo. Un gate din `npm run check` pica daca cele doua se despart, deci copia nu poate ramane in urma.",
  "Cand adaugi o regula noua, o adaugi in fisierul sursa si regenerezi copia cu `npm run rules:sync`.",
  "",
  "## Cele mai des uitate in practica",
  "",
  "Nu sunt reguli noi si nu au prioritate peste celelalte; sunt cele ratate cel mai des:",
  "",
  "- **3** — orice schimbare de cod se reflecta si in documentatie, nu doar in `CHANGELOG.md`.",
  "- **13** — inainte de commit si push, verifica PR-urile deschise cu conflicte sau check-uri picate si rezolva-le intai.",
  "- **22** — cand raman lucruri de implementat, scrie-le undeva; memoria conversatiei nu tine loc de lista.",
  "- **24** — nu se da skip la o problema; singura exceptie e peste 2.000 de linii, si atunci se implementeaza o parte utila.",
  "- **30** — toate implementarile respecta toate regulile de mai jos, nu doar cele care par relevante.",
  "",
  "## Reguli de respectat",
  "",
  ""
];

export function extractRuleBody(rulesMarkdown: string): string {
  const heading = "# Reguli de respectat";
  const at = rulesMarkdown.indexOf(heading);
  if (at === -1) throw new Error(`${RULES_SOURCE} nu are titlul "${heading}"`);
  return rulesMarkdown.slice(at + heading.length).replace(/^[\r\n]+/, "");
}

export function buildAgentRulesDocument(rulesMarkdown: string): string {
  const newline = rulesMarkdown.includes("\r\n") ? "\r\n" : "\n";
  return PREAMBLE.join(newline) + extractRuleBody(rulesMarkdown);
}

export function countRules(text: string): number {
  return text.split(/\r?\n/).filter(line => /^\d+\. /.test(line)).length;
}

export function readRulesSource(repoRoot: string): string {
  return fs.readFileSync(path.join(repoRoot, RULES_SOURCE), "utf8");
}

export function readIfPresent(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

if (process.argv[1] !== undefined && /sync-agent-rules\.(ts|js)$/.test(process.argv[1])) {
  const repoRoot = path.resolve(process.cwd(), "..");
  const document = buildAgentRulesDocument(readRulesSource(repoRoot));
  const target = path.join(repoRoot, AGENT_RULES_FILE);
  const previous = readIfPresent(target);
  if (previous === document) {
    console.log(`${AGENT_RULES_FILE} e deja sincronizat (${countRules(document)} reguli)`);
  } else {
    fs.writeFileSync(target, document);
    console.log(`${AGENT_RULES_FILE} regenerat din ${RULES_SOURCE} (${countRules(document)} reguli)`);
  }
}
