import test from "node:test";
import assert from "node:assert/strict";

import { resolveWatchedGames, watchlistGameFilter } from "../../features/player-count/playerCountWatchlist.js";

const GAMES = [
  { key: "cs2", name: "CS2" },
  { key: "dota", name: "Dota" },
  { key: "tf2", name: "TF2" }
];

test("resolveWatchedGames: watchlist absent sau gol => TOATE jocurile configurate (audit, #1)", () => {
  assert.deepEqual(resolveWatchedGames(undefined, GAMES).map(g => g.key), ["cs2", "dota", "tf2"]);
  assert.deepEqual(resolveWatchedGames(null, GAMES).map(g => g.key), ["cs2", "dota", "tf2"]);
  assert.deepEqual(resolveWatchedGames([], GAMES).map(g => g.key), ["cs2", "dota", "tf2"]);
});

test("resolveWatchedGames: watchlist ne-gol => numai subsetul explicit, normalizat (audit, #1)", () => {
  assert.deepEqual(resolveWatchedGames(["dota"], GAMES).map(g => g.key), ["dota"]);
  assert.deepEqual(resolveWatchedGames(["CS2", "TF2"], GAMES).map(g => g.key), ["cs2", "tf2"]);
  assert.deepEqual(resolveWatchedGames(["inexistent"], GAMES).map(g => g.key), []);
});

test("watchlistGameFilter: selecteaza guild-urile care contin jocul SAU au watchlist implicit (gol/absent) (audit, #1)", () => {
  assert.deepEqual(watchlistGameFilter("cs2"), {
    $or: [{ enabledGames: "cs2" }, { enabledGames: { $size: 0 } }, { enabledGames: null }]
  });
});
