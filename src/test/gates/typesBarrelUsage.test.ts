import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

const srcRoot = process.cwd();
const SKIP_DIRS = new Set(["node_modules", "dist", "target", ".git"]);

const PRODUCTION_IMPORTER_CAP = 90;
const TOTAL_IMPORTER_CAP = 108;

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

const PRIMITIVE_IMPORTABILE = new Set([
  "CurrencyCode", "BotRole", "DiscordReplyPayload", "AbortPredicate", "MaybePromise", "PriceValue",
  "CurrencyPlacement", "LogLevel", "LoggerFunction", "ParseEnvNumber", "ParseEnvNumberLimits",
  "LockToken", "ActiveLocks", "MongoWriteOutcome", "CurrencyConfig", "CurrencyRegistry",
  "LifecycleState", "ConcurrentRunResult", "SystemTimes"
]);

const VERIFICA_BARRELUL: readonly string[] = ["test/gates/domainTypesLocality.test.ts"];

const INVERSIUNE_DE_DEPENDINTA_NECESARA: readonly string[] = [
  "domain/deals/filtersCore.ts",
  "shared/utilities.ts"
];

test("nimeni nu mai trage contracte de domeniu prin barrel", () => {
  const offenders: string[] = [];
  for (const file of typeScriptFiles()) {
    const relative = path.relative(srcRoot, file).split(path.sep).join("/");
    if (relative === "types.ts" || VERIFICA_BARRELUL.includes(relative)) continue;
    if (INVERSIUNE_DE_DEPENDINTA_NECESARA.includes(relative)) continue;
    for (const bloc of fs.readFileSync(file, "utf8").matchAll(/import type \{([^}]*)\} from "(?:\.\.\/)*(?:\.\/)?types\.js"/g)) {
      const straine = bloc[1]
        .split(",")
        .map(nume => nume.trim().split(" as ")[0].trim())
        .filter(nume => nume.length > 0 && !PRIMITIVE_IMPORTABILE.has(nume));
      if (straine.length > 0) offenders.push(`${relative}: ${straine.join(", ")}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "barrel-ul re-exporta contracte de domeniu ca sa nu se rupa importatorii vechi, dar un modul care ia `DealInfo` din " +
      "`types.js` in loc de `sources/sourceTypes.js` isi ascunde dependinta reala: din import nu se mai vede de ce domeniu " +
      `depinde. Plafonul de importatori nu prinde asta, fiindca numarul nu creste (${offenders.join("; ")})`
  );
});

test("cele doua exceptii sunt exact modulele in care barrel-ul ascunde o incalcare de strat", () => {
  for (const relative of INVERSIUNE_DE_DEPENDINTA_NECESARA) {
    const sursa = fs.readFileSync(path.join(srcRoot, relative), "utf8");
    assert.match(
      sursa,
      /from "(?:\.\.\/)*types\.js"/,
      `${relative} inca depinde de barrel; daca dependinta a disparut, scoate-l din lista de exceptii`
    );
  }
  assert.equal(
    INVERSIUNE_DE_DEPENDINTA_NECESARA.length,
    2,
    "lista poate doar sa scada. `domain/deals/filtersCore.ts` are nevoie de DealInfo/GuildSettings/PendingDiscount/PendingUpdate, " +
      "iar `shared/utilities.ts` de DealInfo/ValidatedDealInfo. Ambele sunt straturi declarate PURE: daca importa direct din " +
      "features/sources, `check-layer-imports` pica. Barrel-ul nu le rezolva problema, doar o ascunde de gate - iesirea reala e " +
      "sa mute contractele in domain si ca features/sources sa depinda de domain, nu invers"
  );
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
