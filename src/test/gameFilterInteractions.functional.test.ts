import test from "node:test";
import assert from "node:assert/strict";

type GameFilterModule = ((context: Record<string, unknown>) => void) & {
  createGameFilterInteractionHandlers: (deps: Record<string, unknown>) => {
    handleSetGames: (interaction: Record<string, unknown>, games: Array<Record<string, unknown>>, sub: string, guildId: string) => Promise<unknown>;
    handleSetGamesInteraction: (interaction: Record<string, unknown>, games: Array<Record<string, unknown>>) => Promise<unknown>;
  };
};

const gameFilterInteractions = require("../features/command-handlers/gameFilterHandlers") as GameFilterModule;

type InteractionRuntime = {
  handleInteraction: (interaction: unknown, games?: Array<Record<string, unknown>>) => Promise<unknown>;
};
type MongoCall = unknown[];

const games = [
  { key: "cs2", name: "Counter-Strike 2" },
  { key: "fortnite", name: "Fortnite" }
];

function makeSetGamesInteraction(sub: string, gameKey: string | null = "cs2") {
  return {
    commandName: "set",
    guild: { id: "guild-1" },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    options: {
      getSubcommandGroup: () => "games",
      getSubcommand: () => sub,
      getString: (name: string) => name === "joc" ? gameKey : null
    },
    followUp: async () => undefined,
    reply: async () => undefined
  };
}

function makeBaseContext(calls: MongoCall[], replies: unknown[]) {
  return {
    MessageFlags: { Ephemeral: 64 },
    GuildModel: {
      updateOne: async (...args: unknown[]) => {
        calls.push(args);
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    logger: (_level: string, _context: string, ..._args: unknown[]) => undefined,
    getGuildSettings: async () => ({ enabledGames: ["cs2"] }),
    invalidateGuildCache: (guildId: string) => calls.push(["invalidate", guildId]),
    safeDefer: async (interaction: Record<string, unknown>) => { interaction.deferred = true; },
    safeEdit: async (_interaction: unknown, payload: unknown) => { replies.push(payload); return payload; },
    formatUserError: (_err: unknown, fallback: string) => fallback
  };
}

test("game filter factory writes /set games add through explicit deps", async () => {
  const calls: MongoCall[] = [];
  const replies: unknown[] = [];
  const handlers = gameFilterInteractions.createGameFilterInteractionHandlers(makeBaseContext(calls, replies));

  await handlers.handleSetGames(makeSetGamesInteraction("add"), games, "add", "guild-1");

  assert.deepEqual(calls[0][0], { _id: "guild-1" });
  assert.deepEqual(calls[0][1], { $addToSet: { enabledGames: "cs2" } });
  assert.deepEqual(calls[0][2], { upsert: true });
  assert.deepEqual(calls[1], ["invalidate", "guild-1"]);
  assert.equal(replies[0], "OK: **Counter-Strike 2** adaugat la lista activa.");
});

test("game filter allows /set games remove for stale keys not in current config", async () => {
  const calls: MongoCall[] = [];
  const replies: unknown[] = [];
  const handlers = gameFilterInteractions.createGameFilterInteractionHandlers(makeBaseContext(calls, replies));

  await handlers.handleSetGames(makeSetGamesInteraction("remove", "starcraft2"), games, "remove", "guild-1");

  assert.deepEqual(calls[0][0], { _id: "guild-1" });
  assert.deepEqual(calls[0][1], { $pull: { enabledGames: "starcraft2" } });
  assert.deepEqual(calls[1], ["invalidate", "guild-1"]);
  assert.match(String(replies[0]), /starcraft2.*scos din lista activa/);
  assert.match(String(replies[0]), /cheie nu mai exista in config/,
    "must explicitly note the key was stale so operators understand the curatare");
});

test("game filter still rejects /set games add for unknown keys", async () => {
  const calls: MongoCall[] = [];
  const replies: unknown[] = [];
  const handlers = gameFilterInteractions.createGameFilterInteractionHandlers(makeBaseContext(calls, replies));

  await handlers.handleSetGames(makeSetGamesInteraction("add", "starcraft2"), games, "add", "guild-1");

  assert.equal(calls.length, 0, "must NOT issue a DB write for unknown add key");
  assert.match(String(replies[0]), /Cheia.*nu exista in config/);
});

test("game filter reports no-op when /set games remove finds nothing to pull", async () => {

  const calls: MongoCall[] = [];
  const replies: unknown[] = [];
  const context = makeBaseContext(calls, replies);
  context.GuildModel = {
    updateOne: async (...args: unknown[]) => {
      calls.push(args);
      return { matchedCount: 1, modifiedCount: 0 };
    }
  };
  const handlers = gameFilterInteractions.createGameFilterInteractionHandlers(context);

  await handlers.handleSetGames(makeSetGamesInteraction("remove", "cs2"), games, "remove", "guild-1");

  assert.match(String(replies[0]), /nu era in lista activa, nimic de scos/);
});

test("game filter rejects unknown sub-commands explicitly instead of leaving deferReply hanging", async () => {
  const calls: MongoCall[] = [];
  const replies: unknown[] = [];
  const logs: Array<[string, string, ...unknown[]]> = [];
  const context = makeBaseContext(calls, replies);
  const loggingContext = context as typeof context & { logger: (...args: [string, string, ...unknown[]]) => void };
  loggingContext.logger = (...args: [string, string, ...unknown[]]) => { logs.push(args); };
  const handlers = gameFilterInteractions.createGameFilterInteractionHandlers(loggingContext);

  await handlers.handleSetGames(makeSetGamesInteraction("totally-unknown"), games, "totally-unknown", "guild-1");

  assert.equal(replies.length, 1, "must reply, not leave deferReply hanging");
  assert.match(String(replies[0]), /totally-unknown.*nu este recunoscuta/);
  assert.ok(logs.some(([level, context]) => level === "WARN" && context === "SET_GAMES"));
});

test("game filter installer intercepts only /set games commands", async () => {
  const calls: MongoCall[] = [];
  const replies: unknown[] = [];
  const delegated: string[] = [];
  const context = makeBaseContext(calls, replies);
  const runtimeContext = context as typeof context & Partial<InteractionRuntime>;
  runtimeContext.handleInteraction = async (interaction: unknown) => {
    delegated.push((interaction as { commandName: string }).commandName);
    return "delegated";
  };

  gameFilterInteractions(runtimeContext);
  const runtime = runtimeContext as typeof context & InteractionRuntime;
  await runtime.handleInteraction(makeSetGamesInteraction("remove", "fortnite"), games);
  const result = await runtime.handleInteraction({
    commandName: "latest",
    guild: { id: "guild-1" },
    isChatInputCommand: () => true,
    options: { getSubcommandGroup: () => null }
  }, []);

  assert.deepEqual(calls[0][1], { $pull: { enabledGames: "fortnite" } });
  assert.equal(replies[0], "OK: **Fortnite** scos din lista activa.");
  assert.deepEqual(delegated, ["latest"]);
  assert.equal(result, "delegated");
});
