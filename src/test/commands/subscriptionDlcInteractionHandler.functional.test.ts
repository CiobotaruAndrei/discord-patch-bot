import test from "node:test";
import assert from "node:assert/strict";

import installSubscription from "../../features/command-handlers/subscriptionNotificationHandlers.js";

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
  const handlers = installSubscription.createSubscriptionInteractionHandlers({
    GuildModel: {
      updateOne: async (filter, update, options) => {
        calls.push({ filter, update, options });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    logger: () => undefined,
    getGuildSettings: async () => ({ _id: "guild-1", enabledGames: ["cs2", "portal"], playerCountGames: ["cs2", "portal"], playerCountChannelId: "channel-1" }),
    DEFAULT_CURRENCY: "USD",
    getLatestForAllGames: async () => [],
    fetchDeals: async () => [],
    dealHash: () => "deal-hash",
    seedSeenUpdates: async () => undefined,
    seedSeenDiscounts: async () => undefined,
    fetchSteamCurrentPlayers: async appId => ({ appId: String(appId), playerCount: 1000, success: true }),
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
  return { handlers, calls, replies };
}

test("/start dlc activeaza modulul DLC prin ciclul de activare (activare + finalize cu activation-id) (audit, #12)", async () => {
  const { handlers, calls, replies } = makeDeps();

  await handlers.handleStartInteraction(makeInteraction("start", "dlc"), []);

  assert.equal(calls.length, 2, "activare + finalize, ca la updates/discounts");
  assert.deepEqual(calls[0].update.$set, {
    dlcSubscribed: true,
    dlcChannelId: "channel-1",
    dlcInitializing: true,
    dlcActivationId: "activation-dlc"
  });
  assert.deepEqual(calls[1].update.$set, { dlcInitializing: false });
  assert.equal((calls[1].filter as Record<string, unknown>).dlcActivationId, "activation-dlc", "finalize conditionat de activation-id");
  assert.match(String(replies[0]), /DLC/);
});

test("/stop dlc opreste modulul si curata activarea", async () => {
  const { handlers, calls, replies } = makeDeps();

  await handlers.handleStopInteraction(makeInteraction("stop", "dlc"));

  assert.deepEqual(calls[0].update, {
    $set: { dlcSubscribed: false, dlcChannelId: null, dlcInitializing: false },
    $unset: { dlcActivationId: "" }
  });
  assert.match(String(replies[0]), /DLC/);
});

test("/start player-count activeaza intregul watchlist si salveaza baseline-ul eligibil", async () => {
  const { handlers, calls, replies } = makeDeps();

  await handlers.handleStartInteraction(makeInteraction("start", "player-count"), [
    { key: "cs2", name: "Counter-Strike 2", appId: "730" },
    { key: "portal", name: "Portal" }
  ]);

  assert.equal((calls[0].update.$set as Record<string, unknown>).playerCountSubscribed, false);
  assert.equal((calls[0].update.$set as Record<string, unknown>).playerCountInitializing, true);
  assert.equal(calls[1].filter.playerCountActivationId, "activation-dlc");
  assert.equal((calls[1].update.$set as Record<string, unknown>).playerCountSubscribed, true);
  const state = (calls[1].update.$set as Record<string, unknown>).playerCountWatchState as Array<Record<string, unknown>>;
  assert.equal(state.length, 1);
  assert.equal(state[0].gameKey, "cs2");
  assert.match(String(replies[0]), /watchlist/);
  assert.match(String(replies[0]), /fara Steam appId: 1/);
});

test("/stop player-count opreste intregul watchlist si invalideaza activarea veche", async () => {
  const { handlers, calls, replies } = makeDeps();

  await handlers.handleStopInteraction(makeInteraction("stop", "player-count"));

  assert.deepEqual(calls[0].update, {
    $set: {
      playerCountSubscribed: false,
      playerCountChannelId: null,
      playerCountInitializing: false,
      playerCountWatchState: [],
      playerCountGames: []
    },
    $unset: { playerCountActivationId: "" }
  });
  assert.match(String(replies[0]), /intregul watchlist/);
});
