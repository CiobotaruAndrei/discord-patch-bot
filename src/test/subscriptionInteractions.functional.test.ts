import test from "node:test";
import assert from "node:assert/strict";

type SubscriptionModule = ((context: Record<string, unknown>) => void) & {
  createSubscriptionInteractionHandlers: (deps: Record<string, unknown>) => {
    handleStartInteraction: (interaction: Record<string, unknown>, games: Array<Record<string, unknown>>) => Promise<unknown>;
    handleStopInteraction: (interaction: Record<string, unknown>) => Promise<unknown>;
  };
};

const subscriptionInteractions = require("../features/command-handlers/subscriptionNotificationHandlers") as SubscriptionModule;

type InteractionRuntime = {
  handleInteraction: (interaction: unknown, games?: Array<Record<string, unknown>>) => Promise<unknown>;
};
type MongoCall = unknown[];

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

function makeBaseContext(operations: MongoCall[], replies: unknown[]) {
  return {
    MessageFlags: { Ephemeral: 64 },
    GuildModel: {
      updateOne: async (...args: unknown[]) => {
        operations.push(args);
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    logger: (_level: string, _context: string, ..._args: unknown[]) => undefined,
    getGuildSettings: async () => ({ currency: "USD" }),
    invalidateGuildCache: (guildId: string) => operations.push(["invalidate", guildId]),
    DEFAULT_CURRENCY: "USD",
    getLatestForAllGames: async () => [{ game: { key: "cs2" }, latest: { id: "update-1" } }],
    fetchDeals: async () => [],
    dealHash: (deal: { id: string }) => deal.id,
    seedSeenUpdates: async (guildId: string, entries: Array<{ gameKey: string; updateId: string }>) => { operations.push(["seedUpdates", guildId, entries]); },
    seedSeenDiscounts: async (guildId: string, hashes: string[]) => { operations.push(["seedDiscounts", guildId, hashes]); },
    DEALS_HISTORY_LIMIT: 50,
    OP_UPDATE_OPTS: {},
    setDealsCache: () => undefined,
    safeDefer: async (interaction: Record<string, unknown>) => { interaction.deferred = true; },
    safeEdit: async (_interaction: unknown, payload: unknown) => { replies.push(payload); return payload; },
    canSendEmbeds: () => true,
    missingChannelPermsMessage: () => "Missing permissions",
    makeActivationId: () => "activation-1",
    formatUserError: (_err: unknown, fallback: string) => fallback
  };
}

test("subscription interaction factory handles /start updates with explicit deps", async () => {
  const operations: MongoCall[] = [];
  const replies: unknown[] = [];
  const handlers = subscriptionInteractions.createSubscriptionInteractionHandlers(makeBaseContext(operations, replies));

  await handlers.handleStartInteraction(makeStartInteraction(), [{ key: "cs2" }]);

  assert.equal(replies.at(-1), "OK: Update-uri automate activate.");
  const firstFilter = operations[0][0] as { _id?: string };
  const firstUpdate = operations[0][1] as { $set: { notificationChannelId: string } };
  assert.equal(firstFilter._id, "guild-1");
  assert.equal(firstUpdate.$set.notificationChannelId, "channel-1");
  const seedCall = operations.find(op => Array.isArray(op) && op[0] === "seedUpdates") as ["seedUpdates", string, Array<{ gameKey: string; updateId: string }>];
  assert.ok(seedCall, "baseline-ul de update-uri e seed-uit in colectia dedicata, nu pe documentul guild");
  assert.equal(seedCall[1], "guild-1");
  assert.deepEqual(seedCall[2], [{ gameKey: "cs2", updateId: "update-1" }]);
  const activation = operations.find(op => Array.isArray(op) && op[1] && (op[1] as { $set?: { updatesInitializing?: boolean } }).$set?.updatesInitializing === false) as unknown[];
  assert.ok(activation, "activarea seteaza doar updatesInitializing=false, fara payload seen pe guild");
});

test("subscription /start rejects unknown sub-commands instead of leaving the deferReply hanging", async () => {
  const operations: MongoCall[] = [];
  const replies: unknown[] = [];
  const logs: Array<[string, string, ...unknown[]]> = [];
  const context = makeBaseContext(operations, replies);
  const loggingContext = context as typeof context & { logger: (...args: [string, string, ...unknown[]]) => void };
  loggingContext.logger = (...args: [string, string, ...unknown[]]) => { logs.push(args); };
  const handlers = subscriptionInteractions.createSubscriptionInteractionHandlers(loggingContext);

  const interaction = makeStartInteraction();
  interaction.options.getSubcommand = () => "totally-unknown";

  await handlers.handleStartInteraction(interaction, []);

  assert.equal(operations.length, 0,
    "no DB write must happen for an unknown sub — defer-then-return left the spinner hanging");
  assert.equal(replies.length, 1, "must reply explicitly");
  assert.match(String(replies[0]), /totally-unknown.*nu este recunoscuta/);
  assert.ok(logs.some(([level, context]) => level === "WARN" && context === "START_COMMAND"),
    "must emit a WARN log so operators see the rejected sub");
});

test("subscription /stop rejects unknown sub-commands instead of leaving the deferReply hanging", async () => {

  const operations: MongoCall[] = [];
  const replies: unknown[] = [];
  const logs: Array<[string, string, ...unknown[]]> = [];
  const context = makeBaseContext(operations, replies);
  const loggingContext = context as typeof context & { logger: (...args: [string, string, ...unknown[]]) => void };
  loggingContext.logger = (...args: [string, string, ...unknown[]]) => { logs.push(args); };
  const handlers = subscriptionInteractions.createSubscriptionInteractionHandlers(loggingContext);

  const interaction = makeStartInteraction();
  interaction.commandName = "stop";
  interaction.options.getSubcommand = () => "totally-unknown";

  await handlers.handleStopInteraction(interaction);

  assert.equal(operations.length, 0);
  assert.equal(replies.length, 1);
  assert.match(String(replies[0]), /totally-unknown.*nu este recunoscuta/);
  assert.ok(logs.some(([level, context]) => level === "WARN" && context === "STOP_COMMAND"));
});

test("subscription installer intercepts start/stop and delegates other interactions", async () => {
  const operations: MongoCall[] = [];
  const replies: unknown[] = [];
  const delegated: string[] = [];
  const context = makeBaseContext(operations, replies);
  const runtimeContext = context as typeof context & Partial<InteractionRuntime>;
  runtimeContext.handleInteraction = async (interaction: unknown) => {
    delegated.push((interaction as { commandName: string }).commandName);
    return "delegated";
  };

  subscriptionInteractions(runtimeContext);
  const runtime = runtimeContext as typeof context & InteractionRuntime;
  await runtime.handleInteraction(makeStartInteraction(), [{ key: "cs2" }]);
  const result = await runtime.handleInteraction({
    commandName: "latest",
    guild: { id: "guild-1" },
    isChatInputCommand: () => true
  }, []);

  assert.equal(replies.at(-1), "OK: Update-uri automate activate.");
  assert.deepEqual(delegated, ["latest"]);
  assert.equal(result, "delegated");
});
