import test from "node:test";
import assert from "node:assert/strict";

const mod = require("../features/command-handlers/priceAlertInteractionHandler") as typeof import("../features/command-handlers/priceAlertInteractionHandler");

type MongoCall = {
  filter: Record<string, unknown>;
  update: Record<string, unknown> | Array<Record<string, unknown>>;
  options?: Record<string, unknown>;
};

function makeHarness(settings: Record<string, unknown> = {}) {
  const calls: MongoCall[] = [];
  const replies: unknown[] = [];
  const invalidated: string[] = [];
  const handler = mod.createPriceAlertInteractionHandler({
    GuildModel: {
      updateOne: async (filter, update, options) => {
        calls.push({ filter, update, options });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    getGuildSettings: async () => ({ _id: "guild-1", ...settings }),
    invalidateGuildCache: guildId => { invalidated.push(guildId); },
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); return payload; },
    formatUserError: (_err, fallback) => fallback,
    SUPPORTED_CURRENCIES: { USD: {}, EUR: {}, GBP: {}, RON: {} },
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });
  return { handler, calls, replies, invalidated };
}

function interaction(subcommand: string, values: { joc?: string; price?: number; currency?: string } = {}) {
  return {
    commandName: "price-alert",
    guild: { id: "guild-1" },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => subcommand,
      getString: (name: string) => {
        if (name === "joc") return values.joc || null;
        if (name === "currency") return values.currency || null;
        return null;
      },
      getNumber: (name: string) => name === "price" ? values.price ?? null : null
    },
    reply: async (payload: unknown) => payload,
    followUp: async (payload: unknown) => payload
  };
}

const games = [{
  key: "elden-ring",
  name: "Elden Ring",
  appId: "1245620",
  aliases: ["elden ring"]
}];

test("/price-alert add salveaza regula tipata si pastreaza o singura regula per joc+valuta", async () => {
  const { handler, calls, replies, invalidated } = makeHarness({
    discountsSubscribed: true,
    discountChannelId: "deals-channel",
    priceAlerts: []
  });

  await handler.handlePriceAlertInteraction(
    interaction("add", { joc: "elden-ring", price: 30, currency: "EUR" }),
    games
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].filter, { _id: "guild-1" });
  assert.ok(Array.isArray(calls[0].update));
  const serialized = JSON.stringify(calls[0].update);
  assert.match(serialized, /priceAlerts/);
  assert.match(serialized, /elden-ring/);
  assert.match(serialized, /1245620/);
  assert.match(serialized, /EUR/);
  assert.deepEqual(calls[0].options, { upsert: true });
  assert.deepEqual(invalidated, ["guild-1"]);
  assert.match(String(replies[0]), /30 EUR/);
  assert.match(String(replies[0]), /deals-channel/);
});

test("/price-alert remove sterge toate valutele jocului", async () => {
  const { handler, calls, replies } = makeHarness();

  await handler.handlePriceAlertInteraction(
    interaction("remove", { joc: "elden-ring" }),
    games
  );

  assert.deepEqual(calls[0].update, { $pull: { priceAlerts: { gameKey: "elden-ring" } } });
  assert.match(String(replies[0]), /toate alertele de pret/);
});

test("/price-alert list afiseaza pragul si starea fiecarei alerte", async () => {
  const { handler, replies } = makeHarness({
    priceAlerts: [{
      gameKey: "elden-ring",
      gameName: "Elden Ring",
      threshold: 30,
      currency: "EUR",
      triggeredAt: null,
      lastObservedPrice: 49.99
    }]
  });

  await handler.handlePriceAlertInteraction(interaction("list"), games);

  assert.match(String(replies[0]), /Elden Ring/);
  assert.match(String(replies[0]), /30 EUR/);
  assert.match(String(replies[0]), /armata/);
  assert.match(String(replies[0]), /49.99 EUR/);
});
