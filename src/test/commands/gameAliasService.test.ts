import test from "node:test";
import assert from "node:assert/strict";
import { MAX_ALIASES_PER_GAME, MAX_TOTAL_GAME_ALIASES, aliasOwner, countTotalGameAliases, gameAliasRecord, mergeGuildGameAliases, normalizeGameAlias } from "../../features/guild-config/gameAliasService.js";
import type { GameConfig } from "../../config/configTypes.js";

const games: GameConfig[] = [
  { key: "cs2", name: "Counter-Strike 2", aliases: ["counter strike"], type: "steam" },
  { key: "dota2", name: "Dota 2", aliases: ["dota"], type: "steam" }
];

test("aliasurile locale sunt normalizate, deduplicate si imbinate fara mutarea configuratiei", () => {
  const settings = { _id: "guild-1", gameAliases: { cs2: [" CS ", "cs"] } };
  assert.equal(normalizeGameAlias("  CS   GO "), "cs go");
  assert.deepEqual(gameAliasRecord(settings.gameAliases), { cs2: ["cs"] });
  const merged = mergeGuildGameAliases(games, settings);
  assert.deepEqual(merged[0].aliases, ["counter strike", "cs"]);
  assert.deepEqual(games[0].aliases, ["counter strike"]);
});

test("aliasOwner detecteaza conflictele cu chei, nume, aliasuri globale si locale", () => {
  assert.equal(aliasOwner("DOTA", games, {}), "dota2");
  assert.equal(aliasOwner("cs go", games, { cs2: ["cs go"] }), "cs2");
  assert.equal(aliasOwner("nou", games, {}), null);
});

test("countTotalGameAliases numara aliasurile din toate jocurile (audit #5, 154)", () => {
  assert.equal(countTotalGameAliases({}), 0);
  assert.equal(countTotalGameAliases({ cs2: ["a", "b"], dota2: ["c"] }), 3);
  assert.ok(MAX_ALIASES_PER_GAME > 0 && MAX_TOTAL_GAME_ALIASES >= MAX_ALIASES_PER_GAME, "limitele sunt pozitive si coerente");
});
