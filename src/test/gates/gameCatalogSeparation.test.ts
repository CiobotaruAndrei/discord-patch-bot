import test from "node:test";
import assert from "node:assert/strict";

import {
  loadModule,
  loadModulesUnder,
  calls,
  compositeMembersOf,
  compositeNestedMembers,
  constructedNames,
  exportedFunctionNames,
  linearLookupsByProperty,
  propertyValues,
  allStringLiterals,
  topLevelMembersOf,
  typeReferenceTexts
} from "./sourceStructureQueries.js";

const validator = loadModule("config", "configValidator.ts");
const catalogSchema = loadModule("config", "gameCatalogSchema.ts");
const settings = loadModule("features", "guild-config", "guildSettingsTypes.ts");

const CATALOG_RULES = ["Cheie duplicata in config", "Alias duplicat pentru", "Regex invalid"];

test("validarea catalogului de jocuri traieste in schema catalogului, nu in validatorul de config", () => {
  const schemaMessages = allStringLiterals(catalogSchema);
  const validatorMessages = allStringLiterals(validator);
  for (const rule of CATALOG_RULES) {
    assert.ok(
      schemaMessages.some(message => message.includes(rule)),
      `regula de catalog "${rule}" apartine schemei de catalog`
    );
    assert.ok(
      !validatorMessages.some(message => message.includes(rule)),
      `regula de catalog "${rule}" nu mai are ce cauta in validatorul de config`
    );
  }
  assert.ok(
    typeReferenceTexts(validator).includes("GameCatalogSchema") || propertyValues(validator, "games").includes("GameCatalogSchema"),
    "validatorul de config deleaga partea de catalog schemei de catalog"
  );
  assert.ok(
    propertyValues(validator, "checkIntervalMinutes").length > 0,
    "validatorul de config pastreaza partea operationala"
  );
});

test("configuratia operationala si catalogul static sunt doua lucruri separate in tipuri", () => {
  const types = loadModule("config", "configTypes.ts");
  const loadResult = topLevelMembersOf(types, "ConfigLoadResult").find(member => member.name === "catalog");
  assert.ok(loadResult, "rezultatul incarcarii expune catalogul, nu doar array-ul brut");
  assert.ok(loadResult.type.includes("GameCatalog"), "campul catalog poarta tipul catalogului: " + loadResult.type);
  const loader = loadModule("config", "configLoader.ts");
  assert.ok(
    calls(loader).some(call => call.callee === "createGameCatalog"),
    "catalogul se construieste o singura data, la incarcare"
  );
});

test("Guild pastreaza doar chei de joc, nu copii ale definitiilor din catalog", () => {
  const models = loadModule("infra", "mongo", "models.ts");
  const enabledGames = propertyValues(models, "enabledGames");
  assert.ok(enabledGames.length > 0, "schema Guild are enabledGames");
  for (const declaration of enabledGames) {
    assert.ok(
      declaration.includes("type: [String]"),
      "enabledGames ramane o lista de chei; definitiile jocurilor stau doar in catalog: " + declaration
    );
  }

  const guildFields = compositeMembersOf(settings, "GuildSettings");
  const enabled = guildFields.find(member => member.name === "enabledGames");
  assert.ok(enabled, "GuildSettings declara enabledGames");
  assert.ok(enabled.type.includes("string[]"), "enabledGames ramane o lista de chei in tip: " + enabled.type);

  const copied = ["listingUrl", "listingUrls", "articleHrefRegex", "baseUrl", "requireKeywords"]
    .filter(field => guildFields.some(member => member.name === field));
  assert.deepEqual(
    copied,
    [],
    "campurile astea spun de unde se ia continutul unui joc; daca le copiaza si guild-ul, catalogul nu mai e sursa unica: " +
      copied.join(", ")
  );

  const watchState = compositeNestedMembers(settings, "GuildSettings", "playerCountWatchState").map(member => member.name);
  assert.ok(watchState.includes("appId"), "appId apare in interiorul snapshot-ului de masuratoare");
  assert.deepEqual(
    guildFields.filter(member => member.name === "appId").map(member => member.name),
    [],
    "appId nu are voie sa apara si ca setare de guild, in afara snapshot-ului de player-count"
  );
});

test("cautarile de joc trec prin catalog, nu prin scanari liniare scrise de mana", () => {
  const catalog = loadModule("config", "gameCatalog.ts");
  assert.ok(exportedFunctionNames(catalog).includes("catalogFor"), "catalogul expune constructorul de indexuri");
  assert.ok(constructedNames(catalog).includes("Map"), "cautarea pe cheie si pe alias e indexata, nu liniara");

  const offenders: string[] = [];
  for (const root of ["features", "app", "sources"]) {
    for (const query of loadModulesUnder([root])) {
      const lookups = linearLookupsByProperty(query, "key");
      if (lookups.length > 0) offenders.push(`${query.relativePath}: ${lookups.join(", ")}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `cautarea unui joc dupa cheie se face prin catalog (byKey), nu cu find peste array: ${offenders.join(" | ")}`
  );
});
