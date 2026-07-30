import test from "node:test";
import assert from "node:assert/strict";
import { makeSourceRegistryApi, makeDealInfo, makeGuildDoc, makeNotificationDiscordClient, makeOutboxDiscordClient } from "./typedTestBuilders.js";
import type { GameConfig } from "../config/configTypes.js";

test("makeSourceRegistryApi: stub-urile intorc valori reale tipate, nu null mascat de cast", async () => {
  const api = makeSourceRegistryApi();

  const update = await api.fetchGameUpdate({ key: "g", name: "G", type: "steam" } as GameConfig);
  assert.equal(typeof update.id, "string");
  assert.equal(update.fullText, "");
  assert.equal(update.image, null);

  const game = { key: "g", name: "G", type: "steam" } as GameConfig;
  const result = await api.executeFetchWithCircuitBreaker(game);
  assert.equal(result.game, game);
  assert.equal(result.latest, null);
  assert.equal(result.error, null);

  const reviews = await api.fetchSteamReviewData("570");
  assert.deepEqual(reviews, { totalReviews: 0, qualityPercent: 0, success: false });

  assert.deepEqual(await api.searchSteamGameByName("portal"), []);
  assert.deepEqual(await api.getLatestForAllGames([]), []);
  assert.deepEqual(await api.fetchDeals(), []);
  assert.equal(api.chooseBestSteamMatch(null, "x"), null);
});

test("makeSourceRegistryApi: safeCheerioLoad intoarce un API cheerio functional, fara cast", () => {
  const api = makeSourceRegistryApi();
  const $ = api.safeCheerioLoad("<div class='x'>hi</div>");
  assert.equal($(".x").text(), "hi");
  const empty = api.safeCheerioLoad(undefined);
  assert.equal(empty("div").length, 0);
});

test("makeSourceRegistryApi: enrichDealData pastreaza deal-ul primit", async () => {
  const api = makeSourceRegistryApi();
  const deal = makeDealInfo({ id: "deal-9" });
  assert.equal(await api.enrichDealData(deal), deal);
});

test("makeSourceRegistryApi: override-urile inlocuiesc stub-urile implicite", async () => {
  const api = makeSourceRegistryApi({ fetchDeals: async () => [makeDealInfo({ id: "only" })] });
  const deals = await api.fetchDeals();
  assert.equal(deals.length, 1);
  assert.equal(deals[0].id, "only");
});

test("builder-ele de client/doc raman coerente cu valorile implicite si override-uri", () => {
  assert.equal(makeNotificationDiscordClient().user?.id, "bot-1");
  assert.equal(makeOutboxDiscordClient().isReady(), true);
  assert.equal(makeGuildDoc({ subscribed: false }).subscribed, false);
  assert.equal(makeGuildDoc().notificationChannelId, "channel-1");
});
