import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

const srcRoot = process.cwd();
const SKIP_DIRS = new Set(["node_modules", "dist", "target", ".git"]);

const PRODUCTION_IMPORTER_CAP = 107;
const TOTAL_IMPORTER_CAP = 125;

function typeScriptFiles(): string[] {
  const found: string[] = [];
  const stack = [srcRoot];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(path.join(current, entry.name));
        continue;
      }
      if (entry.name.endsWith(".ts")) found.push(path.join(current, entry.name));
    }
  }
  return found;
}

function barrelImporters(): { total: string[]; production: string[] } {
  const pattern = /from "(?:\.\.\/)*(?:\.\/)?types\.js"/;
  const total: string[] = [];
  for (const file of typeScriptFiles()) {
    const relative = path.relative(srcRoot, file).split(path.sep).join("/");
    if (relative === "types.ts") continue;
    if (!pattern.test(fs.readFileSync(file, "utf8"))) continue;
    total.push(relative);
  }
  return { total, production: total.filter(relative => !relative.startsWith("test/")) };
}

test("numarul de importatori ai barrel-ului de tipuri poate doar sa scada", () => {
  const { total, production } = barrelImporters();
  assert.ok(
    production.length <= PRODUCTION_IMPORTER_CAP,
    `${production.length} fisiere de productie importa din types.js; plafonul e ${PRODUCTION_IMPORTER_CAP}. ` +
      "Importa tipul din modulul care il detine, nu din barrel"
  );
  assert.ok(total.length <= TOTAL_IMPORTER_CAP, `${total.length} fisiere importa din types.js; plafonul e ${TOTAL_IMPORTER_CAP}`);
});

test("barrel-ul nu mai defineste contracte de domeniu, doar primitive si re-exporturi", () => {
  const barrel = fs.readFileSync(path.join(srcRoot, "types.ts"), "utf8");
  const declaredInterfaces = [...barrel.matchAll(/^export interface (\w+)/gm)].map(match => match[1]);
  const allowedInterfaces = new Set([
    "ParseEnvNumberLimits",
    "CurrencyConfig",
    "LifecycleState",
    "SystemTimes",
    "ConcurrentRunResult"
  ]);
  const unexpected = declaredInterfaces.filter(name => !allowedInterfaces.has(name));
  assert.deepEqual(
    unexpected,
    [],
    `${unexpected.join(", ")} sunt contracte definite in barrel; locul lor e in modulul de domeniu care le foloseste`
  );
});

test("forma rezultatului unei scrieri Mongo are o singura definitie", () => {
  const barrel = fs.readFileSync(path.join(srcRoot, "types.ts"), "utf8");
  assert.match(
    barrel,
    /export type \{ WriteCounts as MongoWriteOutcome \} from "\.\/shared\/persistenceOutcome\.js";/,
    "MongoWriteOutcome si WriteCounts descriau acelasi lucru; barrel-ul re-exporta acum definitia din shared"
  );
  assert.ok(
    !/export interface MongoWriteOutcome/.test(barrel),
    "o a doua declaratie a aceleiasi forme poate devia tacut de prima"
  );
});

test("simbolurile ramase in barrel sunt primitive, nu tipuri cu proprietar clar", () => {
  const barrel = fs.readFileSync(path.join(srcRoot, "types.ts"), "utf8");
  const aliases = [...barrel.matchAll(/^export type (\w+) =/gm)].map(match => match[1]);
  for (const name of ["CurrencyCode", "BotRole", "DiscordReplyPayload", "LoggerFunction", "PriceValue", "LogLevel"]) {
    assert.ok(aliases.includes(name), `${name} e o primitiva si ramane in barrel`);
  }
});
