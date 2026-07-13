import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";
import { SlashCommandBuilder, PermissionsBitField } from "discord.js";

const srcRoot = process.cwd();
const repoRoot = path.resolve(srcRoot, "..");
const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
const dockerfile = fs.readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(srcRoot, "package.json"), "utf8"));

interface JsonOption { type: number; name: string; options?: JsonOption[] }
interface JsonCommand { name: string; options?: JsonOption[] }

function definedCommandPaths(): Set<string> {
  const target: Record<string, unknown> = {
    SlashCommandBuilder, PermissionsBitField,
    SUPPORTED_CURRENCIES: { USD: {}, EUR: {}, GBP: {}, RON: {} },
    logger: () => undefined, env: {}
  };
  const attachSlashCommands = require("../features/command-definitions/slashCommandDefinitions").default as (t: Record<string, unknown>) => void;
  attachSlashCommands(target);
  const defs = (target.buildSlashCommandDefinitions as () => JsonCommand[])();
  const paths = new Set<string>();
  for (const cmd of defs) {
    paths.add(cmd.name);
    for (const opt of cmd.options || []) {
      if (opt.type === 1) paths.add(`${cmd.name} ${opt.name}`);
      else if (opt.type === 2) {
        paths.add(`${cmd.name} ${opt.name}`);
        for (const sub of opt.options || []) {
          if (sub.type === 1) paths.add(`${cmd.name} ${opt.name} ${sub.name}`);
        }
      }
    }
  }
  return paths;
}

function documentedCommandPaths(): string[] {
  const start = readme.indexOf("## Comenzi principale");
  assert.ok(start >= 0, "README are sectiunea '## Comenzi principale'");
  const nextHeading = readme.indexOf("\n## ", start + 1);
  const section = readme.slice(start, nextHeading === -1 ? undefined : nextHeading);
  const re = /`(\/[^`]+)`/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) !== null) {
    const cleaned = m[1].slice(1).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    const alternatives = cleaned.split("|").map(p => p.trim()).filter(Boolean);
    const head = alternatives[0].split(/\s+/);
    const command = head[0];
    out.push(head.join(" "));
    for (let i = 1; i < alternatives.length; i++) {
      out.push(`${command} ${alternatives[i]}`.replace(/\s+/g, " ").trim());
    }
  }
  return out;
}

function documentedNpmScripts(): string[] {
  const re = /npm run ([a-z0-9:_-]+)/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(readme)) !== null) out.add(m[1]);
  return [...out];
}

test("P2.1: toate slash command-urile documentate in README exista in buildSlashCommandDefinitions", () => {
  const defined = definedCommandPaths();
  const documented = documentedCommandPaths();
  assert.ok(documented.length >= 10, "sectiunea de comenzi a fost parsata");
  for (const docPath of documented) {
    assert.ok(defined.has(docPath), `comanda documentata '/${docPath}' exista in definitii (altfel README descrie o comanda inexistenta)`);
  }
});

test("docs sync: docs/Comenzi Functionalitate.md mentioneaza toate comenzile top-level din slash definitions (anti-drift)", () => {
  const doc = fs.readFileSync(path.join(repoRoot, "docs", "Comenzi Functionalitate.md"), "utf8");
  const topLevel = [...definedCommandPaths()].filter(p => !p.includes(" "));
  assert.ok(topLevel.length >= 10, "exista comenzi top-level in definitii");
  for (const command of topLevel) {
    assert.match(doc, new RegExp(`/${command}\\b`),
      `docs/Comenzi Functionalitate.md mentioneaza /${command} (drift: comanda noua in slash definitions dar absenta din doc)`);
  }
});

test("P2.1: definitiile contin comenzile cheie (ancore de sanitate pentru parser)", () => {
  const defined = definedCommandPaths();
  for (const expected of ["ping", "help", "start updates", "set add games", "set outbox-recovery-verify", "outbox status", "outbox recovery-verify status"]) {
    assert.ok(defined.has(expected), `definitiile contin '${expected}'`);
  }
  assert.ok(!defined.has("set game-state"), "nu exista subcomanda 'set game-state' (de aceea a fost scoasa din README)");
});

test("P1.4: toate scripturile 'npm run X' documentate in README exista in package.json", () => {
  const scripts = new Set(Object.keys(pkg.scripts || {}));
  const documented = documentedNpmScripts();
  assert.ok(documented.includes("test:e2e"), "README documenteaza npm run test:e2e");
  for (const script of documented) {
    assert.ok(scripts.has(script), `scriptul documentat 'npm run ${script}' exista in package.json`);
  }
});

test("package.json: orice 'npm run X' referit din alt script exista (compunerile nu pot drifta)", () => {
  const scripts = (pkg.scripts || {}) as Record<string, string>;
  const names = new Set(Object.keys(scripts));
  for (const [name, command] of Object.entries(scripts)) {
    const re = /npm run ([a-z0-9:_-]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(command)) !== null) {
      assert.ok(names.has(m[1]), `scriptul '${name}' refera 'npm run ${m[1]}', care nu exista in package.json`);
    }
  }
});

test("scripturile de conveniena R8: exista, iar audit:strict e mai strict decat audit (fara prag de severitate)", () => {
  const scripts = (pkg.scripts || {}) as Record<string, string>;
  for (const name of ["clean", "rebuild", "check:quick", "test:notifications", "audit:strict"]) {
    assert.ok(typeof scripts[name] === "string" && scripts[name].length > 0, `scriptul '${name}' exista`);
  }
  assert.ok(!scripts["audit:strict"].includes("--audit-level"), "audit:strict nu are prag de severitate — esueaza la orice vulnerabilitate");
  assert.ok(scripts["audit"].includes("--audit-level=moderate"), "audit ramane pe pragul moderate");
  assert.ok(scripts["clean"].includes("rmSync") && scripts["clean"].includes("dist"), "clean sterge dist/ cross-platform prin node, nu prin rm");
});

test("Docker: imaginea ruleaza direct `node dist/app/main.js`, fara npm", () => {
  assert.match(dockerfile, /CMD\s*\[\s*"node"\s*,\s*"dist\/app\/main\.js"\s*\]/,
    "Dockerfile-ul porneste botul prin `node dist/app/main.js`, nu prin npm");
  assert.match(dockerfile, /rm -rf[^\n]*\bnpm\b/,
    "Dockerfile-ul sterge npm/npx din imaginea finala");
});

test("README descrie corect runtime-ul Docker (consistent cu Dockerfile)", () => {
  assert.ok(!/`npm start` \(folosit in Docker\)/.test(readme),
    "README nu mai sustine ca Docker ruleaza prin `npm start` (Dockerfile-ul ruleaza `node dist/app/main.js`)");
  assert.ok(readme.includes("node dist/app/main.js"),
    "README mentioneaza runtime-ul real (`node dist/app/main.js`) pentru Docker/npm start");
});

test("docs sync: /status e descris ca status server pentru un joc (nu starea botului), iar interactions.ts nu mai e revendicat ca router activ", () => {
  const statusLine = readme.split("\n").find(line => /^- `\/status\b/.test(line)) || "";
  assert.ok(statusLine, "README listeaza comanda /status");
  assert.match(statusLine, /joc/, "README descrie /status ca status server pentru un joc, nu 'starea botului' (aceea e /health)");

  const interactionsExists = ["interactions.ts", path.join("features", "interactions.ts")]
    .some(rel => fs.existsSync(path.join(srcRoot, rel)));
  assert.ok(!interactionsExists, "interactions.ts nu exista (routing-ul e lista tipata CommandHandler[] + dispatchCommand din commandRegistry)");

  const context = fs.readFileSync(path.join(repoRoot, "docs", "architecture", "CONTEXT_REPO_CLEAN.md"), "utf8");
  const staleRouterClaim = /`interactions\.ts` (este|trebuie tratat ca)[^\n]*(router|routing|wiring|delega)/;
  assert.ok(!staleRouterClaim.test(readme), "README nu mai revendica `interactions.ts` ca router/wiring activ (fisierul nu mai exista)");
  assert.ok(!staleRouterClaim.test(context), "CONTEXT_REPO_CLEAN.md nu mai revendica `interactions.ts` ca strat de routing activ");
});

test("docs sync: FUNCTION_MAP_CLEAN si CONTEXT_REPO_CLEAN descriu routing-ul nou (lista tipata CommandHandler[] + dispatchCommand), nu lantul vechi de attachX", () => {
  const functionMap = fs.readFileSync(path.join(repoRoot, "docs", "architecture", "FUNCTION_MAP_CLEAN.md"), "utf8");
  const context = fs.readFileSync(path.join(repoRoot, "docs", "architecture", "CONTEXT_REPO_CLEAN.md"), "utf8");

  for (const [name, doc] of [["FUNCTION_MAP_CLEAN.md", functionMap], ["CONTEXT_REPO_CLEAN.md", context]] as const) {
    assert.match(doc, /CommandHandler\[\]/, `${name} descrie routing-ul ca lista tipata CommandHandler[]`);
    assert.match(doc, /dispatchCommand/, `${name} mentioneaza dispatcher-ul dispatchCommand (loop canHandle/handle)`);
    assert.ok(!/attachX\(ctx\)[^\n]*(in lant|impacheteaza)/.test(doc),
      `${name} nu mai descrie routing-ul ca lant de attachX(ctx) care impacheteaza handleInteraction`);
    assert.ok(!/lant de responsabilitate/.test(doc),
      `${name} nu mai descrie routing-ul de comenzi ca lant de responsabilitate (e lista tipata + dispatcher)`);
  }
});
