import test from "node:test";
import assert from "node:assert/strict";

import installSubscription from "../features/command-handlers/subscriptionNotificationHandlers.js";

type MongoCall = {
  filter: Record<string, unknown>;
  update: Record<string, unknown>;
  options?: Record<string, unknown>;
};

function makeInteraction(commandName: "start" | "stop", subcommand: string) {
  return {
    commandName,
    guild: { id: "guild-1" },
    channel: { id: "channel-1" },
    client: { user: { id: "bot-1" } },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => subcommand,
      getString: () => "cs2"
    },
    reply: async (payload: unknown) => payload,
    followUp: async (payload: unknown) => payload
  };
}

function makeDeps() {
  const calls: MongoCall[] = [];
  const replies: unknown[] = [];
  const invalidated: string[] = [];
  const handlers = installSubscription.createSubscriptionInteractionHandlers({
    GuildModel: {
      updateOne: async (filter, update, options) => {
        calls.push({ filter, update, options });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    logger: () => undefined,
    getGuildSettings: async () => ({ _id: "guild-1", playerCountGames: ["cs2", "portal"], playerCountChannelId: "channel-1" }),
    invalidateGuildCache: guildId => { invalidated.push(guildId); },
    DEFAULT_CURRENCY: "USD",
    getLatestForAllGames: async () => [],
    fetchDeals: async () => [],
    dealHash: () => "deal-hash",
    seedSeenUpdates: async () => undefined,
    seedSeenDiscounts: async () => undefined,
    DEALS_HISTORY_LIMIT: 10,
    OP_UPDATE_OPTS: {},
    setDealsCache: () => undefined,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); return payload; },
    canSendEmbeds: () => true,
    listMissingChannelPerms: () => [],
    missingChannelPermsMessage: () => "lipsesc permisiuni",
    makeActivationId: () => "activation-dlc",
    formatUserError: (_err, fallback) => fallback
  });
  return { handlers, calls, replies, invalidated };
}

test("/start dlc salveaza canalul si activarea DLC", async () => {
  const { handlers, calls, replies, invalidated } = makeDeps();

  await handlers.handleStartInteraction(makeInteraction("start", "dlc"), []);

  assert.deepEqual(calls[0].update, {
    $set: {
      dlcSubscribed: true,
      dlcChannelId: "channel-1",
      dlcInitializing: false,
      dlcActivationId: "activation-dlc"
    }
  });
  assert.deepEqual(invalidated, ["guild-1"]);
  assert.match(String(replies[0]), /DLC/);
});

test("/stop dlc opreste modulul si curata activarea", async () => {
  const { handlers, calls, replies, invalidated } = makeDeps();

  await handlers.handleStopInteraction(makeInteraction("stop", "dlc"));

  assert.deepEqual(calls[0].update, {
    $set: { dlcSubscribed: false, dlcChannelId: null, dlcInitializing: false },
    $unset: { dlcActivationId: "" }
  });
  assert.deepEqual(invalidated, ["guild-1"]);
  assert.match(String(replies[0]), /DLC/);
});

test("/start player-count salveaza jocul si canalul curent", async () => {
  const { handlers, calls, replies, invalidated } = makeDeps();

  await handlers.handleStartInteraction(makeInteraction("start", "player-count"), [{ key: "cs2", name: "Counter-Strike 2", appId: "730" }]);

  assert.deepEqual(calls[0].update, {
    $set: { playerCountSubscribed: true, playerCountChannelId: "channel-1" },
    $addToSet: { playerCountGames: "cs2" }
  });
  assert.deepEqual(invalidated, ["guild-1"]);
  assert.match(String(replies[0]), /player-count pornit/);
});

test("/stop player-count scoate jocul si pastreaza modulul activ cand mai exista jocuri", async () => {
  const { handlers, calls, replies, invalidated } = makeDeps();

  await handlers.handleStopInteraction(makeInteraction("stop", "player-count"), [{ key: "cs2", name: "Counter-Strike 2", appId: "730" }]);

  assert.deepEqual(calls[0].update, {
    $set: {
      playerCountGames: ["portal"],
      playerCountSubscribed: true,
      playerCountChannelId: "channel-1"
    }
  });
  assert.deepEqual(invalidated, ["guild-1"]);
  assert.match(String(replies[0]), /player-count oprit/);
});
