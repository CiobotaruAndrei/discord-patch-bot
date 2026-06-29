import test from "node:test";
import assert from "node:assert/strict";

import type { DealInfo } from "../types";

const installPriceCheck = require("../features/command-handlers/priceCheckInteractionHandler") as typeof import("../features/command-handlers/priceCheckInteractionHandler");

function makeInteraction(query: string) {
  return {
    commandName: "price-check",
    guild: { id: "guild-1" },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    options: {
      getString: (name: string) => name === "joc" ? query : null
    },
    reply: async (payload: unknown) => payload,
    followUp: async (payload: unknown) => payload
  };
}

test("/price-check compara Steam cu sursele externe si ignora Steam/entry-uri fara titlu", async () => {
  const replies: unknown[] = [];
  const logStatuses: string[] = [];
  const deals: DealInfo[] = [
    { title: "Elden Ring", store: "Steam", salePrice: 20, currency: "EUR", link: "https://store.steampowered.com/app/1245620" },
    { title: "", store: "External Empty", salePrice: 10, currency: "EUR", link: "https://example.test/empty" },
    { title: "Elden Ring Shadow", store: "Humble", salePrice: "29.99", currency: "EUR", link: "https://example.test/elden" }
  ];
  const handler = installPriceCheck.createPriceCheckInteractionHandler({
    logger: () => undefined,
    enforceCooldown: async () => true,
    startCommandLog: () => status => { logStatuses.push(status || ""); },
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); return payload; },
    searchSteamGameByName: async () => [{ id: "1245620", name: "Elden Ring" }],
    chooseBestSteamMatch: items => items[0] ?? null,
    fetchSteamPriceDetails: async () => ({
      name: "Elden Ring",
      is_free: false,
      price_overview: { initial: 5999, final: 3999, discount_percent: 33 }
    }),
    getDealsCacheData: () => deals,
    setDealsCache: () => undefined,
    fetchDeals: async () => [],
    getGuildSettings: async () => ({ _id: "guild-1", currency: "EUR" }),
    formatPrice: (value, currency) => `${value} ${currency || "EUR"}`,
    DEFAULT_CURRENCY: "EUR",
    MessageFlags: { Ephemeral: 64 }
  });

  await handler.handlePriceCheck(makeInteraction("elden ring"));

  assert.match(String(replies[0]), /Se incarca/);
  const payload = replies[1] as { embeds?: Array<{ color?: number; fields?: Array<{ name: string; value: string }> }> };
  assert.equal(payload.embeds?.[0]?.color, 0x2ecc71);
  const fields = payload.embeds?.[0]?.fields || [];
  assert.ok(fields.some(field => field.name === "Steam" && /Steam \[verde\]/.test(field.value)));
  assert.ok(fields.some(field => field.name === "Humble" && /29.99 EUR/.test(field.value)));
  assert.ok(!fields.some(field => field.name === "External Empty"));
  assert.deepEqual(logStatuses, ["ok"]);
});

test("/price-check embed explica lipsa surselor externe cand fetch-ul pica", () => {
  const embed = installPriceCheck.buildPriceCheckEmbed(
    "elden",
    "1245620",
    { name: "Elden Ring", price_overview: { initial: 5999, final: 3999, discount_percent: 33 } },
    [],
    "EUR",
    (value, currency) => `${value} ${currency || "EUR"}`,
    "Nu am putut incarca sursele externe acum: timeout"
  );

  const fields = embed.fields as Array<{ name: string; value: string }>;
  assert.equal(embed.color, 0x2ecc71);
  assert.ok(fields.some(field => field.name === "Alte surse" && /timeout/.test(field.value)));
});
