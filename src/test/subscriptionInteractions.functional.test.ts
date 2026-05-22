import test from "node:test";
import assert from "node:assert/strict";

type SubscriptionModule = ((ctx: Record<string, any>) => void) & {
  createSubscriptionInteractionHandlers: (deps: Record<string, any>) => {
    handleStartInteraction: (interaction: Record<string, any>, games: Array<Record<string, any>>) => Promise<unknown>;
    handleStopInteraction: (interaction: Record<string, any>) => Promise<unknown>;
  };
};

const subscriptionInteractions = require("../features/command-handlers/subscriptionNotificationHandlers") as SubscriptionModule;

function makeStartInteraction() {
  return {
    commandName: "start",
    guild: { id: "guild-1" },
    channel: { id: "channel-1" },
    client: { user: { id: "bot-1" } },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    options: { getSubcommand: () => "updates" },
    followUp: async () => undefined,
    reply: async () => undefined
  };
}

function makeBaseContext(operations: any[], replies: any[]) {
  return {
    MessageFlags: { Ephemeral: 64 },
    GuildModel: {
      updateOne: async (...args: any[]) => {
        operations.push(args);
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    logger: () => undefined,
    getGuildSettings: async () => ({ currency: "USD" }),
    invalidateGuildCache: (guildId: string) => operations.push(["invalidate", guildId]),
    DEFAULT_CURRENCY: "USD",
    getLatestForAllGames: async () => [{ game: { key: "cs2" }, latest: { id: "update-1" } }],
    fetchDeals: async () => [],
    dealHash: (deal: { id: string }) => deal.id,
    DEALS_HISTORY_LIMIT: 50,
    OP_UPDATE_OPTS: {},
    setDealsCache: () => undefined,
    safeDefer: async (interaction: Record<string, any>) => { interaction.deferred = true; },
    safeEdit: async (_interaction: unknown, payload: unknown) => { replies.push(payload); return payload; },
    canSendEmbeds: () => true,
    missingChannelPermsMessage: () => "Missing permissions",
    makeActivationId: () => "activation-1",
    formatUserError: (_err: unknown, fallback: string) => fallback
  };
}

test("subscription interaction factory handles /start updates with explicit deps", async () => {
  const operations: any[] = [];
  const replies: any[] = [];
  const handlers = subscriptionInteractions.createSubscriptionInteractionHandlers(makeBaseContext(operations, replies));

  await handlers.handleStartInteraction(makeStartInteraction(), [{ key: "cs2" }]);

  assert.equal(replies.at(-1), "OK: Update-uri automate activate.");
  assert.equal(operations[0][0]._id, "guild-1");
  assert.equal(operations[0][1].$set.notificationChannelId, "channel-1");
  assert.equal(operations[2][1].$set["seen.cs2"][0], "update-1");
});

test("subscription installer intercepts start/stop and delegates other interactions", async () => {
  const operations: any[] = [];
  const replies: any[] = [];
  const delegated: string[] = [];
  const ctx: Record<string, any> = makeBaseContext(operations, replies);
  ctx.handleInteraction = async (interaction: Record<string, any>) => {
    delegated.push(interaction.commandName);
    return "delegated";
  };

  subscriptionInteractions(ctx);
  await ctx.handleInteraction(makeStartInteraction(), [{ key: "cs2" }]);
  const result = await ctx.handleInteraction({
    commandName: "latest",
    guild: { id: "guild-1" },
    isChatInputCommand: () => true
  }, []);

  assert.equal(replies.at(-1), "OK: Update-uri automate activate.");
  assert.deepEqual(delegated, ["latest"]);
  assert.equal(result, "delegated");
});
