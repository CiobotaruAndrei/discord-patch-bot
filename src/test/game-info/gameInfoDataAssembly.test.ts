import test from "node:test";
import assert from "node:assert/strict";

import {
  assemblePlayerCount,
  assembleReviewTrend,
  assembleTopActive,
  type FreshSnapshot
} from "../../features/game-info/gameInfoDataAssembly.js";
import type { GameConfig } from "../../config/configTypes.js";
import type { SteamCurrentPlayersSummary } from "../../sources/sourceApis.js";

const NOW = new Date("2026-07-20T12:00:00.000Z");

function game(key: string, appId: string): GameConfig {
  return { key, name: key, appId } as GameConfig;
}

test("review-trend: fereastra de istoric e de 15 zile inainte de momentul curent", async () => {
  const asked: Date[] = [];
  await assembleReviewTrend(730, "dota", {
    fetchReview: async () => ({ success: true, totalReviews: 100, qualityPercent: 80 }),
    readHistory: async (_appId, since) => { asked.push(since); return []; },
    now: () => NOW
  });
  assert.equal(asked[0]?.toISOString(), "2026-07-05T12:00:00.000Z");
});

test("review-trend: un istoric indisponibil nu opreste comanda", async () => {
  const result = await assembleReviewTrend(730, "dota", {
    fetchReview: async () => ({ success: true, totalReviews: 100, qualityPercent: 80 }),
    readHistory: async () => { throw new Error("Mongo picat"); },
    now: () => NOW
  });
  assert.equal(result.review.totalReviews, 100, "raspunsul curent ramane valid fara istoric");
});

test("review-trend: o esuare a scrierii snapshot-ului nu anuleaza raspunsul deja calculat", async () => {
  const result = await assembleReviewTrend(730, "dota", {
    fetchReview: async () => ({ success: true, totalReviews: 100, qualityPercent: 80 }),
    recordSnapshot: async () => { throw new Error("scriere esuata"); },
    now: () => NOW
  });
  assert.equal(result.review.success, true);
});

test("review-trend: un raspuns Steam nereusit nu devine punct de comparatie", async () => {
  const recorded: Array<{ success: boolean }> = [];
  const result = await assembleReviewTrend(730, "dota", {
    fetchReview: async () => ({ success: false, totalReviews: 0, qualityPercent: 0 }),
    readHistory: async () => [{ appId: "730", gameKey: "dota", totalReviews: 90, qualityPercent: 75, at: new Date("2026-07-06T00:00:00.000Z") }],
    recordSnapshot: async (_appId, _key, review) => { recorded.push({ success: review.success }); return true; },
    now: () => NOW
  });
  assert.equal(result.analysis, null, "fara un punct recent valid nu se raporteaza o tendinta inventata");
  assert.deepEqual(recorded, [{ success: false }], "esecul se inregistreaza totusi, ca sa se vada in istoric");
});

test("player-count: snapshotul proaspat evita complet apelul live", async () => {
  let liveCalls = 0;
  const result = await assemblePlayerCount(730, {
    readFreshSnapshots: async () => new Map<string, FreshSnapshot>([["730", { playerCount: 42 }]]),
    fetchCurrentPlayers: async () => { liveCalls += 1; return { appId: "730", playerCount: 0, success: false }; },
    now: () => NOW
  });
  assert.equal(liveCalls, 0, "cache-ul proaspat exista tocmai ca sa nu mai lovim Steam");
  assert.deepEqual(result.players, { appId: "730", playerCount: 42, success: true });
});

test("player-count: fara snapshot se merge live, pe fereastra de 24 de ore", async () => {
  const asked: Date[] = [];
  const result = await assemblePlayerCount(730, {
    readFreshSnapshots: async () => new Map(),
    fetchCurrentPlayers: async () => ({ appId: "730", playerCount: 7, success: true }),
    readHistory: async (_appIds, since) => { asked.push(since); return []; },
    now: () => NOW
  });
  assert.equal(result.players.playerCount, 7);
  assert.equal(asked[0]?.toISOString(), "2026-07-19T12:00:00.000Z");
});

test("top: jocurile din snapshot nu se refetch-uiesc, doar cele lipsa", async () => {
  const fetched: string[] = [];
  const games = [game("a", "1"), game("b", "2"), game("c", "3")];
  const result = await assembleTopActive(games, {
    readFreshSnapshots: async () => new Map<string, FreshSnapshot>([["1", { playerCount: 10 }], ["3", { playerCount: 30 }]]),
    fetchCurrentPlayers: async appId => { fetched.push(appId); return { appId, playerCount: 20, success: true }; },
    mapWithConcurrency: async (items, _concurrency, worker) => Promise.all(items.map(worker)),
    onFetchFailed: () => undefined,
    candidateCap: 25,
    concurrency: 5
  });
  assert.deepEqual(fetched, ["2"], "doar jocul fara snapshot ajunge la Steam");
  assert.equal(result.playerCounts.length, 3);
  assert.equal(result.notChecked, 0);
});

test("top: plafonul de candidati raporteaza cate jocuri au ramas neverificate", async () => {
  const games = [game("a", "1"), game("b", "2"), game("c", "3"), game("d", "4")];
  const result = await assembleTopActive(games, {
    readFreshSnapshots: async () => new Map(),
    fetchCurrentPlayers: async appId => ({ appId, playerCount: 1, success: true }),
    mapWithConcurrency: async (items, _concurrency, worker) => Promise.all(items.map(worker)),
    onFetchFailed: () => undefined,
    candidateCap: 2,
    concurrency: 5
  });
  assert.equal(result.playerCounts.length, 2);
  assert.equal(result.notChecked, 2, "utilizatorul afla ca lista e partiala, nu primeste tacut un top incomplet");
});

test("top: un joc care esueaza intra in lista cu zero jucatori si e raportat, nu pierdut", async () => {
  const failures: string[] = [];
  const games = [game("a", "1"), game("b", "2")];
  const result = await assembleTopActive(games, {
    readFreshSnapshots: async () => new Map(),
    fetchCurrentPlayers: async (appId): Promise<SteamCurrentPlayersSummary> => {
      if (appId === "2") throw new Error("Steam 503");
      return { appId, playerCount: 5, success: true };
    },
    mapWithConcurrency: async (items, _concurrency, worker) => Promise.all(items.map(worker)),
    onFetchFailed: appId => { failures.push(appId); },
    candidateCap: 25,
    concurrency: 5
  });
  assert.deepEqual(failures, ["2"]);
  assert.equal(result.playerCounts.length, 2);
  assert.deepEqual(
    result.playerCounts.find(entry => entry.game.key === "b")?.players,
    { appId: "2", playerCount: 0, success: false },
    "esecul e marcat explicit, ca embed-ul sa nu-l prezinte ca zero real"
  );
});
