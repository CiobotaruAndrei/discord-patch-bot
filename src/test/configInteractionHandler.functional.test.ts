import test from "node:test";
import assert from "node:assert/strict";

import mod from "../features/command-handlers/configInteractionHandler.js";
import { buildConfigEmbed } from "../features/command-handlers/configView.js";

test("buildConfigEmbed afiseaza setarile importante ale serverului", () => {
  const embed = buildConfigEmbed({
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
    discountRoleId: "role-deals",
    adminAlertChannelId: "chan-admin",
    priceAlerts: [{ gameKey: "cs2", gameName: "Counter-Strike 2", threshold: 20, currency: "EUR" }],
    youtubeChannels: [{
      channelId: "UC123",
      channelName: "Creator",
      channelUrl: "https://www.youtube.com/channel/UC123",
      subscribedAt: new Date()
    }],
    youtubeChannelRoutes: [{ channelId: "UC123", discordChannelIds: ["route-1", "route-2"] }],
    youtubeTitleIncludeWords: ["patch"],
    youtubeMessageTemplate: "{title} {url}"
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
  assert.match(text, /<#chan-admin>/);
  assert.match(text, /1 configurate/);
  assert.match(text, /2 rute speciale/);
  assert.match(text, /1 filtre de titlu/);
  assert.match(text, /sablon mesaj: personalizat/);
});

test("buildConfigEmbed arata canalul salvat chiar cand notificarile sunt oprite, ca adminul sa stie ce ramane configurat (R12 #4)", () => {
  const embed = buildConfigEmbed({
    _id: "g2",
    subscribed: false,
    notificationChannelId: "chan-updates",
    discountsSubscribed: false,
    discountChannelId: null
  }, [], "USD");
  const text = JSON.stringify(embed);
  assert.match(text, /<#chan-updates> \(oprit\)/, "canalul de update ramane vizibil cu eticheta (oprit), nu doar 'oprit'");
  assert.match(text, /neconfigurat \(oprit\)/, "canalul de reduceri lipsa apare ca 'neconfigurat (oprit)', nu doar 'oprit'");
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
