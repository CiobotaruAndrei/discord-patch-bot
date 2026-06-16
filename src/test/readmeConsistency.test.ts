import test from "node:test";
import assert from "node:assert/strict";

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");
const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");

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
  const attachSlashCommands = require("../features/command-definitions/slashCommandDefinitions") as (t: Record<string, unknown>) => void;
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

test("P2.1: definitiile contin comenzile cheie (ancore de sanitate pentru parser)", () => {
  const defined = definedCommandPaths();
  for (const expected of ["ping", "help", "start updates", "set games add", "set outbox-recovery-verify", "outbox status", "outbox recovery-verify status"]) {
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
