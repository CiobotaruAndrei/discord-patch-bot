import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __pathDirname } from "node:path";
import fs from "node:fs";
import path from "node:path";
import {
  ALLOWED_GAME_TYPES,
  SOURCE_TYPE_VALIDATORS,
  validateSteamSource,
  validateRssSource,
  type SourceRefinement
} from "../../config/sourceTypeValidators.js";

const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);
const configRoot = path.join(__dirname, "..", "..", "..", "config");

test("validatoarele per source type traiesc in sourceTypeValidators.ts, iar configValidator doar dispatcheaza (review 22 #18)", () => {
  const validators = fs.readFileSync(path.join(configRoot, "sourceTypeValidators.ts"), "utf8");
  for (const name of ["validateSteamSource", "validateListingBasedSource", "validateIntelSource", "validateRssSource", "validateEpicGamesSource", "validateSourceFallbacks"]) {
    assert.ok(validators.includes("export function " + name + "("), name + " e definit in modulul dedicat");
  }
  const validator = fs.readFileSync(path.join(configRoot, "configValidator.ts"), "utf8");
  assert.ok(!validator.includes('message: "Jocurile Steam trebuie sa aiba appId"'), "regula Steam nu mai e inline in superRefine");
  assert.match(validator, /if \(type === "steam"\) validateSteamSource\(game, path, refinement\);/, "dispatch-ul pe tip apeleaza validatorul dedicat");
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
