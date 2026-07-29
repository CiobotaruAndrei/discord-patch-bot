import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

const srcRoot = process.cwd();

function read(relative: string): string {
  return fs.readFileSync(path.join(srcRoot, relative), "utf8");
}

test("validarea catalogului de jocuri traieste in schema catalogului, nu in validatorul de config", () => {
  const validator = read("config/configValidator.ts");
  const catalogSchema = read("config/gameCatalogSchema.ts");

  for (const rule of ["Cheie duplicata in config", "Alias duplicat pentru", "Regex invalid"]) {
    assert.ok(catalogSchema.includes(rule), `regula de catalog "${rule}" apartine schemei de catalog`);
    assert.ok(!validator.includes(rule), `regula de catalog "${rule}" nu mai are ce cauta in validatorul de config`);
  }

  assert.match(validator, /games: GameCatalogSchema/, "validatorul de config deleaga partea de catalog");
  assert.match(
    validator,
    /checkIntervalMinutes/,
    "validatorul de config pastreaza doar partea operationala"
  );
});

test("configuratia operationala si catalogul static sunt doua lucruri separate in tipuri", () => {
  const types = read("config/configTypes.ts");
  assert.match(types, /catalog: GameCatalog;/, "rezultatul incarcarii expune catalogul, nu doar array-ul brut");
  const loader = read("config/configLoader.ts");
  assert.match(loader, /createGameCatalog\(games\)/, "catalogul se construieste o singura data, la incarcare");
});

test("Guild pastreaza doar chei de joc, nu copii ale definitiilor din catalog", () => {
  const schema = read("infra/mongo/models.ts");
  const guildStart = schema.indexOf("enabledGames");
  assert.notEqual(guildStart, -1, "schema Guild are enabledGames");
  assert.match(
    schema.slice(guildStart, guildStart + 80),
    /enabledGames: \{ type: \[String\]/,
    "enabledGames ramane o lista de chei; definitiile jocurilor stau doar in catalog"
  );
  const settings = read("features/guild-config/guildSettingsTypes.ts");
  assert.match(settings, /enabledGames\?: string\[\];/);
  for (const sourceField of ["listingUrl", "listingUrls", "articleHrefRegex", "baseUrl", "requireKeywords"]) {
    assert.ok(
      !new RegExp(`\\b${sourceField}\\??:`).test(settings),
      `${sourceField} spune de unde se ia continutul unui joc; daca il copiaza si guild-ul, catalogul nu mai e sursa unica`
    );
  }
  const watchState = settings.slice(settings.indexOf("playerCountWatchState"), settings.indexOf("gameAliases"));
  assert.match(watchState, /appId: string;/, "appId apare doar in interiorul unui snapshot de masuratoare");
  assert.equal(
    settings.split("appId").length - 1,
    1,
    "appId nu are voie sa apara si ca setare de guild in afara snapshot-ului de player-count"
  );
});

test("cautarile de joc trec prin catalog, nu prin scanari liniare scrise de mana", () => {
  const catalog = read("config/gameCatalog.ts");
  assert.match(catalog, /export function catalogFor/);
  assert.match(catalog, /new Map<string, G>\(\)/, "cautarea pe cheie si pe alias e indexata");

  const offenders: string[] = [];
  const stack = [path.join(srcRoot, "features"), path.join(srcRoot, "app"), path.join(srcRoot, "sources")];
  while (stack.length) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      const source = fs.readFileSync(full, "utf8");
      if (/\.find\(\s*(?:\(?\w+\)?)\s*=>\s*\w+\.key === /.test(source)) {
        offenders.push(path.relative(srcRoot, full));
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `cautarea unui joc dupa cheie se face prin catalog (byKey), nu cu find peste array: ${offenders.join(", ")}`
  );
});
