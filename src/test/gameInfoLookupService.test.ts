import test from "node:test";
import assert from "node:assert/strict";

import type { DealInfo } from "../types.js";
import {
  PLAYER_COUNT_SNAPSHOT_FRESH_MS,
  createGameInfoLookupService,
  type GameInfoLookupDeps
} from "../features/command-handlers/gameInfoLookupService.js";

function makeDeps(overrides: Partial<GameInfoLookupDeps> = {}): GameInfoLookupDeps & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    warnings,
    logger: (level, _context, message) => {
      if (level === "WARN") warnings.push(message);
    },
    searchSteamGameByName: async () => [],
    chooseBestSteamMatch: () => null,
    fetchSteamPriceDetails: async () => null,
    getDealsCacheData: () => null,
    setDealsCache: () => {},
    fetchDeals: async () => [],
    getGuildSettings: async () => null,
    DEFAULT_CURRENCY: "EUR",
    ...overrides
  };
}

test("resolveCurrency prefera valuta explicita, apoi valuta guild-ului, apoi default-ul", async () => {
  const lookup = createGameInfoLookupService(makeDeps({
    getGuildSettings: async () => ({ _id: "guild-1", currency: "RON" })
  }));

  assert.equal(await lookup.resolveCurrency("USD", "guild-1"), "USD");
  assert.equal(await lookup.resolveCurrency(null, "guild-1"), "RON");
  assert.equal(await lookup.resolveCurrency(null, null), "EUR");
});

test("loadDeals intoarce cache-ul cand exista si populeaza cache-ul dupa fetch cand lipseste", async () => {
  const cachedDeals: DealInfo[] = [{ title: "din-cache" }];
  const fetchedDeals: DealInfo[] = [{ title: "din-fetch" }];
  const cacheWrites: Array<{ currency: string; deals: DealInfo[] }> = [];
  let cache: DealInfo[] | null = cachedDeals;
  const lookup = createGameInfoLookupService(makeDeps({
    getDealsCacheData: () => cache,
    setDealsCache: (currency, deals) => cacheWrites.push({ currency, deals }),
    fetchDeals: async () => fetchedDeals
  }));

  assert.deepEqual(await lookup.loadDeals("EUR"), cachedDeals);
  assert.equal(cacheWrites.length, 0);

  cache = null;
  assert.deepEqual(await lookup.loadDeals("USD"), fetchedDeals);
  assert.deepEqual(cacheWrites, [{ currency: "USD", deals: fetchedDeals }]);
});

test("resolveSteam intoarce null fara match si detaliile cand Steam gaseste jocul", async () => {
  const noMatch = createGameInfoLookupService(makeDeps());
  assert.equal(await noMatch.resolveSteam("joc-inexistent", "EUR"), null);

  const details = { name: "Joc Real" };
  const lookup = createGameInfoLookupService(makeDeps({
    searchSteamGameByName: async () => [{ id: 42, name: "Joc Real" }],
    chooseBestSteamMatch: items => items[0] ?? null,
    fetchSteamPriceDetails: async () => details
  }));

  assert.deepEqual(await lookup.resolveSteam("joc real", "EUR"), { appId: 42, details });
});

test("readFreshSnapshots pastreaza doar snapshot-urile proaspete si intoarce map gol fara sursa de snapshot", async () => {
  const now = Date.now();
  const freshDate = new Date(now - PLAYER_COUNT_SNAPSHOT_FRESH_MS + 60_000);
  const staleDate = new Date(now - PLAYER_COUNT_SNAPSHOT_FRESH_MS - 60_000);
  const lookup = createGameInfoLookupService(makeDeps({
    readPlayerCountSnapshots: async () => new Map([
      ["100", { appId: "100", gameKey: "fresh-game", playerCount: 1234, fetchedAt: freshDate }],
      ["200", { appId: "200", gameKey: "stale-game", playerCount: 5678, fetchedAt: staleDate }]
    ])
  }));

  const fresh = await lookup.readFreshSnapshots(["100", "200"]);
  assert.deepEqual([...fresh.keys()], ["100"]);
  assert.equal(fresh.get("100")?.playerCount, 1234);

  const withoutSource = createGameInfoLookupService(makeDeps());
  assert.equal((await withoutSource.readFreshSnapshots(["100"])).size, 0);
});

test("readFreshSnapshots trece pe fetch live cu WARN cand citirea snapshot-urilor arunca", async () => {
  const deps = makeDeps({
    readPlayerCountSnapshots: async () => {
      throw new Error("mongo indisponibil");
    }
  });
  const lookup = createGameInfoLookupService(deps);

  const fresh = await lookup.readFreshSnapshots(["100"]);
  assert.equal(fresh.size, 0);
  assert.equal(deps.warnings.length, 1);
});
