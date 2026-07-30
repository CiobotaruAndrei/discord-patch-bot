import test from "node:test";
import assert from "node:assert/strict";

import type { PriceValue } from "../../types.js";
import type { GuildSettings } from "../../features/guild-config/guildSettingsTypes.js";
import type { DealInfo } from "../../sources/sourceTypes.js";

import installDealScore from "../../features/command-handlers/dealScoreInteractionHandler.js";
import type { DealPricePoint } from "../../features/game-info/dealPriceHistoryService.js";

function makeInteraction(game: string) {
  return {
    commandName: "deal-score",
    guild: { id: "guild-1" },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    options: {
      getString: (name: string) => name === "game" ? game : null
    },
    reply: async (payload: unknown) => payload,
    followUp: async (payload: unknown) => payload
  };
}

function makeHarness(settings: GuildSettings | null, deals: DealInfo[], history: DealPricePoint[] = []) {
  const replies: unknown[] = [];
  const logs: string[] = [];
  const handler = installDealScore.createDealScoreInteractionHandler({
    logger: () => undefined,
    enforceCooldown: async () => true,
    startCommandLog: () => (status?: string) => { if (status) logs.push(status); },
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); return payload; },
    getDealsCacheData: () => deals,
    setDealsCache: () => undefined,
    fetchDeals: async () => [],
    recordDealPriceSnapshots: async () => deals.length,
    readDealPriceHistory: async () => history,
    getGuildSettings: async () => settings,
    formatPrice: (value: PriceValue, currencyCode?: string | null) => `${currencyCode || "USD"} ${value}`,
    DEFAULT_CURRENCY: "USD",
    MessageFlags: { Ephemeral: 64 }
  });
  return { handler, replies, logs };
}

test("scoreDeal acorda scor mare reducerilor puternice cu semnale bune", () => {
  const scored = installDealScore.scoreDeal({
    title: "Elden Ring",
    store: "Steam",
    normalPrice: 60,
    salePrice: 20,
    discountPercent: 67,
    qualityScore: 95,
    popularityScore: 90
  });

  assert.ok(scored.score >= 6);
  assert.ok(scored.reasons.some(reason => reason.includes("67%")));
});

test("scoreDeal diferentiaza doua reduceri egale prin pozitia fata de istoricul real", () => {
  const deal: DealInfo = { title: "Game", store: "Steam", currency: "EUR", normalPrice: 60, salePrice: 20, discountPercent: 67 };
  const atMinimum = installDealScore.scoreDeal(deal, {
    sampleCount: 4,
    historicalMin: 20,
    recentMedian: 32,
    confidence: "medium"
  });
  const aboveUsual = installDealScore.scoreDeal(deal, {
    sampleCount: 4,
    historicalMin: 8,
    recentMedian: 14,
    confidence: "medium"
  });
  assert.ok(atMinimum.score > aboveUsual.score);
  assert.match(atMinimum.reasons.join(" "), /minim istoric 20/);
});

test("scoreDeal declara incredere redusa cand istoricul este insuficient", () => {
  const scored = installDealScore.scoreDeal({ title: "Game", store: "Epic", salePrice: 10, discountPercent: 50 }, {
    sampleCount: 2,
    historicalMin: 9,
    recentMedian: 9.5,
    confidence: "low"
  });
  assert.equal(scored.confidence, "low");
  assert.match(scored.reasons.join(" "), /istoric insuficient \(2\/3/);
});

test("/deal-score foloseste ofertele din cache si afiseaza scorul potrivit", async () => {
  const deals: DealInfo[] = [
    { title: "Other Game", store: "Epic", salePrice: 5, normalPrice: 10, discountPercent: 50 },
    { title: "Elden Ring Deluxe", store: "Steam", salePrice: 19.99, normalPrice: 59.99, discountPercent: 67, qualityScore: 95 }
  ];
  const { handler, replies, logs } = makeHarness({ _id: "guild-1", currency: "EUR" }, deals);

  await handler.handleDealScore(makeInteraction("elden ring"));

  assert.deepEqual(logs, ["ok"]);
  const payload = replies[0] as { embeds?: Array<{ title?: string; description?: string; fields?: Array<{ value?: string }> }> };
  assert.match(String(payload.embeds?.[0]?.title ?? ""), /Elden Ring Deluxe/);
  assert.match(String(payload.embeds?.[0]?.description ?? ""), /Scor:/);
  assert.match(String(payload.embeds?.[0]?.fields?.[0]?.value ?? ""), /reducere 67%/);
  assert.match(String(payload.embeds?.[0]?.fields?.[0]?.value ?? ""), /istoric insuficient/);
});

test("/deal-score foloseste numai seria istorica furnizata pentru oferta selectata", async () => {
  const deals: DealInfo[] = [
    { title: "Elden Ring", store: "Steam", currency: "EUR", salePrice: 20, normalPrice: 60, discountPercent: 67 }
  ];
  const history: DealPricePoint[] = [20, 28, 34].map((price, index) => ({ price, at: new Date(2026, 0, index + 1) }));
  const { handler, replies } = makeHarness({ _id: "guild-1", currency: "EUR" }, deals, history);
  await handler.handleDealScore(makeInteraction("Elden Ring"));
  const payload = replies[0] as { embeds?: Array<{ fields?: Array<{ value?: string }> }> };
  assert.match(String(payload.embeds?.[0]?.fields?.[0]?.value ?? ""), /minim istoric 20/);
  assert.match(String(payload.embeds?.[0]?.fields?.[0]?.value ?? ""), /incredere medium/);
});
