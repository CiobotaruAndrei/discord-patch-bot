import test from "node:test";
import assert from "node:assert/strict";

import type { DealInfo, GuildSettings, PriceValue } from "../types.js";

import installDealScore from "../features/command-handlers/dealScoreInteractionHandler.js";

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

function makeHarness(settings: GuildSettings | null, deals: DealInfo[]) {
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
});
