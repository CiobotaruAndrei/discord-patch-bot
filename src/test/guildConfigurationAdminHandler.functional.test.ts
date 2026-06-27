import test from "node:test";
import assert from "node:assert/strict";

const mod = require("../features/command-handlers/guildConfigurationAdminHandler") as typeof import("../features/command-handlers/guildConfigurationAdminHandler");

function makeHarness(permissionState = { sendMessages: true, embedLinks: true, readMessageHistory: true }) {
  const calls: Array<{ filter: Record<string, unknown>; update: Record<string, unknown>; options?: Record<string, unknown> }> = [];
  const replies: unknown[] = [];
  const handler = mod.createGuildConfigurationAdminHandler({
    GuildModel: {
      updateOne: async (filter, update, options) => {
        calls.push({ filter, update, options });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    invalidateGuildCache: () => undefined,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); return payload; },
    checkChannelPermissions: async () => permissionState,
    DEFAULT_CURRENCY: "USD",
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });
  return { handler, calls, replies };
}

function interaction(
  commandName: "reset-config" | "admin-alerts",
  subcommand = "set",
  options: { confirm?: boolean; channelId?: string } = {}
) {
  return {
    commandName,
    guild: { id: "guild-1" },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => subcommand,
      getBoolean: () => options.confirm ?? null,
      getChannel: () => options.channelId ? { id: options.channelId } : null
    },
    reply: async (payload: unknown) => payload,
    followUp: async (payload: unknown) => payload
  };
}

test("/reset-config confirm:true reseteaza toate suprafetele de configurare", async () => {
  const { handler, calls, replies } = makeHarness();

  await handler.handleGuildConfigurationAdmin(interaction("reset-config", "set", { confirm: true }));

  const setDoc = calls[0].update.$set as Record<string, unknown>;
  assert.equal(setDoc.subscribed, false);
  assert.equal(setDoc.discountsSubscribed, false);
  assert.equal(setDoc.currency, "USD");
  assert.deepEqual(setDoc.enabledGames, []);
  assert.deepEqual(setDoc.priceAlerts, []);
  assert.equal(setDoc.adminAlertChannelId, null);
  assert.equal(setDoc.youtubeHasActivated, false);
  assert.equal(setDoc.youtubeMessageTemplate, null);
  assert.deepEqual(setDoc.youtubeChannelRoutes, []);
  assert.deepEqual(setDoc.youtubeTitleIncludeWords, []);
  assert.match(String(replies[0]), /resetata la valorile implicite/);
});

test("/reset-config refuza operatia fara confirm:true", async () => {
  const { handler, calls, replies } = makeHarness();

  await handler.handleGuildConfigurationAdmin(interaction("reset-config", "set", { confirm: false }));

  assert.equal(calls.length, 0);
  assert.match(String(replies[0]), /anulata/);
});

test("/admin-alerts set verifica permisiunile si salveaza canalul", async () => {
  const { handler, calls, replies } = makeHarness();

  await handler.handleGuildConfigurationAdmin(interaction("admin-alerts", "set", { channelId: "bot-logs" }));

  assert.deepEqual(calls[0].update, { $set: { adminAlertChannelId: "bot-logs" } });
  assert.match(String(replies[0]), /bot-logs/);
});

test("/admin-alerts set refuza canalul fara Embed Links", async () => {
  const { handler, calls, replies } = makeHarness({
    sendMessages: true,
    embedLinks: false,
    readMessageHistory: true
  });

  await handler.handleGuildConfigurationAdmin(interaction("admin-alerts", "set", { channelId: "bot-logs" }));

  assert.equal(calls.length, 0);
  assert.match(String(replies[0]), /Embed Links/);
});
