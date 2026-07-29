import test from "node:test";
import assert from "node:assert/strict";

import { catalogFor, createGameCatalog, normalizeGameKey } from "../../config/gameCatalog.js";
import type { CatalogGame } from "../../config/gameCatalog.js";

const GAMES: CatalogGame[] = [
  { key: "cs2", name: "Counter-Strike 2", type: "steam", appId: "730", aliases: ["CS 2", "counter strike"] },
  { key: "minecraft", name: "Minecraft", type: "minecraft" },
  { key: "fortnite", name: "Fortnite", type: "epic_games", aliases: ["FN"] }
];

test("catalogul raspunde pe cheie exacta, pe nume si pe alias", () => {
  const catalog = createGameCatalog(GAMES);
  assert.equal(catalog.byKey("cs2")?.key, "cs2");
  assert.equal(catalog.byKeyOrAlias("Counter-Strike 2")?.key, "cs2");
  assert.equal(catalog.byKeyOrAlias("CS 2")?.key, "cs2");
  assert.equal(catalog.byKeyOrAlias("counter strike")?.key, "cs2");
  assert.equal(catalog.byKeyOrAlias("FN")?.key, "fortnite");
  assert.equal(catalog.byKey("inexistent"), null);
  assert.equal(catalog.byKeyOrAlias("inexistent"), null);
});

test("cheia si aliasul se normalizeaza la fel, deci punctuatia si majusculele nu conteaza", () => {
  const catalog = createGameCatalog(GAMES);
  assert.equal(normalizeGameKey("Counter-Strike 2"), "counter strike 2");
  assert.equal(catalog.byKeyOrAlias("  counter-STRIKE   2 ")?.key, "cs2");
});

test("catalogul cunoaste tipul si identificatorul de platforma, nu doar numele", () => {
  const catalog = createGameCatalog(GAMES);
  assert.equal(catalog.typeOf("cs2"), "steam");
  assert.equal(catalog.platformId("cs2"), "730");
  assert.equal(catalog.typeOf("minecraft"), "minecraft");
  assert.equal(catalog.platformId("minecraft"), null, "doar sursele Steam au appId");
  assert.equal(catalog.platformId("inexistent"), null);
});

test("subsetul activ pastreaza ordinea catalogului, iar lista goala inseamna toate jocurile", () => {
  const catalog = createGameCatalog(GAMES);
  assert.deepEqual(catalog.enabledSubset(["fortnite", "cs2"]).map(game => game.key), ["cs2", "fortnite"]);
  assert.deepEqual(catalog.enabledSubset([]).map(game => game.key), ["cs2", "minecraft", "fortnite"]);
  assert.deepEqual(catalog.enabledSubset(null).map(game => game.key), ["cs2", "minecraft", "fortnite"]);
});

test("versiunea de continut se schimba cand catalogul se schimba si ramane stabila cand nu", () => {
  const first = createGameCatalog(GAMES);
  const same = createGameCatalog([...GAMES]);
  const changed = createGameCatalog([...GAMES, { key: "dota2", name: "Dota 2", type: "steam", appId: "570" }]);
  assert.equal(first.contentVersion, same.contentVersion);
  assert.notEqual(first.contentVersion, changed.contentVersion);
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.size, 3);
});

test("catalogul derivat dintr-o lista este reutilizat, nu reconstruit la fiecare cautare", () => {
  const games = [...GAMES];
  assert.equal(catalogFor(games), catalogFor(games));
  assert.notEqual(catalogFor(games), catalogFor([...GAMES]));
});
