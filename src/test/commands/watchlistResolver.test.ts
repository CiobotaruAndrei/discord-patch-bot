import test from "node:test";
import assert from "node:assert/strict";
import { isImplicitWatchlist, resolveWatchlistKeys, watchlistFilter } from "../../features/guild-config/watchlistResolver.js";

const games = [{ key: "a", name: "A" }, { key: "b", name: "B" }];

test("watchlist resolver treats absent and empty configuration as implicit default", () => {
  assert.equal(isImplicitWatchlist(undefined), true);
  assert.deepEqual(resolveWatchlistKeys(games, []), ["a", "b"]);
  assert.equal(watchlistFilter([]), null);
});

test("watchlist resolver keeps only explicit configured games", () => {
  assert.deepEqual(resolveWatchlistKeys(games, ["b", "missing"]), ["b"]);
  assert.deepEqual([...watchlistFilter(["b"])!], ["b"]);
});
