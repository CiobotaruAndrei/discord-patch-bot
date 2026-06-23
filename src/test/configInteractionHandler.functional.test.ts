import test from "node:test";
import assert from "node:assert/strict";

const mod = require("../features/command-handlers/configInteractionHandler") as typeof import("../features/command-handlers/configInteractionHandler");

test("buildConfigEmbed afiseaza setarile importante ale serverului", () => {
  const embed = mod.buildConfigEmbed({
    _id: "g1",
    subscribed: true,
    notificationChannelId: "chan-updates",
    discountsSubscribed: true,
    discountChannelId: "chan-deals",
    minDiscountPercent: 55,
    includeFreeGames: false,
    includePaidDiscounts: true,
    notificationMode: "compact",
    currency: "EUR",
    enabledStores: ["Steam"],
    enabledGames: ["cs2"],
    maxAbsolutePrice: 30,
    notificationRoleId: "role-updates",
    discountRoleId: "role-deals"
  }, [{ key: "cs2", name: "Counter-Strike 2" }], "USD");

  const text = JSON.stringify(embed);
  assert.match(text, /mode: compact/);
  assert.match(text, /mindiscount: 55%/);
  assert.match(text, /maxprice: 30/);
  assert.match(text, /free: off/);
  assert.match(text, /paid: on/);
  assert.match(text, /currency: EUR/);
  assert.match(text, /stores: Steam/);
  assert.match(text, /Counter-Strike 2/);
  assert.match(text, /<@&role-updates>/);
  assert.match(text, /<#chan-updates>/);
});

test("/config citeste guild settings si raspunde ephemeral cu embed", async () => {
  const edits: unknown[] = [];
  const handler = mod.createConfigInteractionHandler({
    logger: () => undefined,
    enforceCooldown: async () => true,
    startCommandLog: () => () => undefined,
    safeDefer: async (_interaction, ephemeral) => {
      assert.equal(ephemeral, true);
    },
    safeEdit: async (_interaction, payload) => {
      edits.push(payload);
      return payload;
    },
    getGuildSettings: async () => ({
      _id: "g1",
      subscribed: false,
      discountsSubscribed: false,
      enabledGames: []
    }),
    DEFAULT_CURRENCY: "USD",
    MessageFlags: { Ephemeral: 64 }
  });

  await handler.handleConfigInteraction({
    commandName: "config",
    guild: { id: "g1" },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    reply: async payload => payload,
    followUp: async payload => payload
  }, [{ key: "cs2", name: "Counter-Strike 2" }]);

  assert.equal(edits.length, 1);
  assert.match(JSON.stringify(edits[0]), /Configuratie server/);
  assert.match(JSON.stringify(edits[0]), /toate jocurile configurate/);
});
