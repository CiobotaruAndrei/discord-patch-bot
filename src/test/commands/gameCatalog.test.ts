import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGameKey, findGameByKey, findGameByKeyOrAlias } from "../../config/gameCatalog.js";
import type { GameConfig } from "../../config/configTypes.js";

const games: GameConfig[] = [
  { key: "cs2", name: "Counter-Strike 2", aliases: ["cs", "counter strike"] },
  { key: "dota2", name: "Dota 2", aliases: ["dota"] }
];

test("normalizeGameKey lowercase + colapseaza non-alfanumerice in spatii", () => {
  assert.equal(normalizeGameKey("Counter-Strike_2"), "counter strike 2");
  assert.equal(normalizeGameKey("  DOTA  "), "dota");
});

test("findGameByKey face match exact pe key, altfel null (inclusiv input gol)", () => {
  assert.equal(findGameByKey(games, "cs2")?.key, "cs2");
  assert.equal(findGameByKey(games, "necunoscut"), null);
  assert.equal(findGameByKey(games, null), null);
  assert.equal(findGameByKey(games, undefined), null);
});

test("findGameByKeyOrAlias face match pe key, nume sau alias (normalizat)", () => {
  assert.equal(findGameByKeyOrAlias(games, "cs2")?.key, "cs2");
  assert.equal(findGameByKeyOrAlias(games, "Counter-Strike 2")?.key, "cs2");
  assert.equal(findGameByKeyOrAlias(games, "cs")?.key, "cs2");
  assert.equal(findGameByKeyOrAlias(games, "DOTA")?.key, "dota2");
  assert.equal(findGameByKeyOrAlias(games, "nimic"), null);
  assert.equal(findGameByKeyOrAlias(games, ""), null);
});
