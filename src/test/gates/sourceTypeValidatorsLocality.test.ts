import test from "node:test";
import assert from "node:assert/strict";

import { loadModule, calls, identifierNames, imports, typeAliasTarget } from "./sourceStructureQueries.js";

import {
  ALLOWED_GAME_TYPES,
  SOURCE_TYPE_VALIDATORS,
  validateSteamSource,
  validateRssSource,
  type SourceRefinement
} from "../../config/sourceTypeValidators.js";

const schemas = loadModule("config", "gameConfigSchemas.ts");
const validator = loadModule("config", "configValidator.ts");

const DISCRIMINATED_TYPES = ["steam", "minecraft", "epic_games", "roblox", "listing_based", "nvidia", "amd", "intel", "rss"];

test("schemele Zod per source type traiesc separat, iar configValidator consuma configuratia normalizata", () => {
  const literals = new Set(
    calls(schemas)
      .filter(call => call.callee === "z.literal")
      .map(call => call.args[0]?.replace(/^["']|["']$/g, ""))
  );
  const missing = DISCRIMINATED_TYPES.filter(type => !literals.has(type));
  assert.deepEqual(missing, [], `fiecare tip are schema discriminata; lipsesc: ${missing.join(", ")}`);

  assert.equal(
    typeAliasTarget(schemas, "NormalizedGameConfig"),
    "z.output<typeof GameSchema>",
    "configuratia normalizata isi ia forma din schema, nu dintr-un tip scris separat care poate devia"
  );

  const fromSchemas = imports(validator).find(entry => entry.module.endsWith("gameConfigSchemas.js"));
  assert.ok(fromSchemas, "validatorul importa schemele de joc");
  for (const name of ["GameSchema", "GameTypeSchema"]) {
    assert.ok(fromSchemas.named.includes(name), `validatorul ia ${name} din modulul de scheme`);
  }
  assert.ok(
    !identifierNames(validator).has("validateSteamSource"),
    "validatorul de config nu mai cunoaste validatoarele per tip de sursa"
  );
});

test("dispatch-ul acopera exact tipurile cu reguli dedicate, iar lista de tipuri permise e sursa unica", () => {
  assert.deepEqual(Object.keys(SOURCE_TYPE_VALIDATORS).sort(), ["epic_games", "intel", "listing_based", "rss", "steam"]);
  for (const key of Object.keys(SOURCE_TYPE_VALIDATORS)) {
    assert.ok(ALLOWED_GAME_TYPES.has(key), `${key} e un tip permis`);
  }
});

test("validatoarele emit aceleasi mesaje ca inainte (paritate de comportament)", () => {
  const issues: Array<{ path: Array<string | number>; message: string }> = [];
  const refinement: SourceRefinement = { addIssue: issue => { issues.push({ path: issue.path, message: issue.message }); } };
  validateSteamSource({ key: "cs2", appId: "abc" }, ["games", 0], refinement);
  validateRssSource({ key: "feed" }, ["games", 1], refinement);
  assert.deepEqual(issues, [
    { path: ["games", 0, "appId"], message: "appId pentru Steam trebuie sa contina doar cifre" },
    { path: ["games", 1, "url"], message: "Sursele rss trebuie sa aiba url (URL-ul feed-ului RSS/Atom)" }
  ]);
});
