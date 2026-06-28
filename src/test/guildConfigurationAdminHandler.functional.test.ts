import test from "node:test";
import assert from "node:assert/strict";

const mod = require("../features/command-handlers/guildConfigurationAdminHandler") as typeof import("../features/command-handlers/guildConfigurationAdminHandler");

function makeHarness(permissionState = { sendMessages: true, embedLinks: true, readMessageHistory: true }, replayCleanupFails = false) {
  const calls: Array<{ filter: Record<string, unknown>; update: Record<string, unknown>; options?: Record<string, unknown> }> = [];
  const replies: unknown[] = [];
  const replayPayloadDeletes: string[] = [];
  const handler = mod.createGuildConfigurationAdminHandler({
    GuildModel: {
      updateOne: async (filter, update, options) => {
        calls.push({ filter, update, options });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    invalidateGuildCache: () => undefined,
    deleteAllReplayPayloads: async (guildId: string) => {
      replayPayloadDeletes.push(guildId);
      if (replayCleanupFails) throw new Error("Mongo indisponibil la stergerea payload-urilor de replay");
    },
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); return payload; },
    checkChannelPermissions: async () => permissionState,
    DEFAULT_CURRENCY: "USD",
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });
  return { handler, calls, replies, replayPayloadDeletes };
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
  const { handler, calls, replies, replayPayloadDeletes } = makeHarness();

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
  assert.deepEqual(setDoc.notificationDeadLetter, [], "lista dead-letter vizibila e golita");
  assert.deepEqual(replayPayloadDeletes, ["guild-1"], "reset-ul sterge si payload-urile de replay din colectia separata, ca sa nu ramana orfane (R14 #2)");
  assert.match(String(replies[0]), /resetata la valorile implicite/);
  assert.match(String(replies[0]), /payload-urile de replay au fost sterse/);
});

test("/reset-config confirm:true: daca stergerea payload-urilor de replay esueaza, raspunsul spune onest ca cleanup-ul a esuat, nu succes total (R15 #2)", async () => {
  const { handler, calls, replies } = makeHarness(undefined, true);

  await handler.handleGuildConfigurationAdmin(interaction("reset-config", "set", { confirm: true }));

  assert.ok(calls.length >= 1, "configuratia tot a fost resetata (updateOne a rulat)");
  const reply = String(replies[0]);
  assert.match(reply, /Partial/i, "raspunsul nu mai pretinde succes total");
  assert.match(reply, /ESUAT|esuat/, "raspunsul spune clar ca stergerea payload-urilor de replay a esuat");
  assert.match(reply, /clear-deadletters/, "indica remediere: reia /outbox clear-deadletters");
  assert.doesNotMatch(reply, /payload-urile de replay au fost sterse/, "nu mai afirma fals ca payload-urile au fost sterse");
});

test("/reset-config refuza operatia fara confirm:true (nu sterge payload-urile de replay)", async () => {
  const { handler, calls, replies, replayPayloadDeletes } = makeHarness();

  await handler.handleGuildConfigurationAdmin(interaction("reset-config", "set", { confirm: false }));
  assert.deepEqual(replayPayloadDeletes, [], "fara confirm nu se sterge nimic");

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
