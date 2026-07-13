import test from "node:test";
import assert from "node:assert/strict";
import { aliasOwner, gameAliasRecord, mergeGuildGameAliases, normalizeGameAlias } from "../../features/guild-config/gameAliasService.js";
import type { GameConfig } from "../../types.js";

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
