import test from "node:test";
import assert from "node:assert/strict";

type GameFilterModule = ((ctx: Record<string, any>) => void) & {
  createGameFilterInteractionHandlers: (deps: Record<string, any>) => {
    handleSetGames: (interaction: Record<string, any>, games: Array<Record<string, any>>, sub: string, guildId: string) => Promise<unknown>;
    handleSetGamesInteraction: (interaction: Record<string, any>, games: Array<Record<string, any>>) => Promise<unknown>;
  };
};

const gameFilterInteractions = require("../features/commands/gameFilterInteractions") as GameFilterModule;

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

function makeBaseContext(calls: any[], replies: any[]) {
  return {
    MessageFlags: { Ephemeral: 64 },
    GuildModel: {
      updateOne: async (...args: any[]) => {
        calls.push(args);
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    logger: () => undefined,
    getGuildSettings: async () => ({ enabledGames: ["cs2"] }),
    invalidateGuildCache: (guildId: string) => calls.push(["invalidate", guildId]),
    safeDefer: async (interaction: Record<string, any>) => { interaction.deferred = true; },
    safeEdit: async (_interaction: unknown, payload: unknown) => { replies.push(payload); return payload; },
    formatUserError: (_err: unknown, fallback: string) => fallback
  };
}

test("game filter factory writes /set games add through explicit deps", async () => {
  const calls: any[] = [];
  const replies: any[] = [];
  const handlers = gameFilterInteractions.createGameFilterInteractionHandlers(makeBaseContext(calls, replies));

  await handlers.handleSetGames(makeSetGamesInteraction("add"), games, "add", "guild-1");

  assert.deepEqual(calls[0][0], { _id: "guild-1" });
  assert.deepEqual(calls[0][1], { $addToSet: { enabledGames: "cs2" } });
  assert.deepEqual(calls[0][2], { upsert: true });
  assert.deepEqual(calls[1], ["invalidate", "guild-1"]);
  assert.equal(replies[0], "OK: **Counter-Strike 2** adaugat la lista activa.");
});

test("game filter installer intercepts only /set games commands", async () => {
  const calls: any[] = [];
  const replies: any[] = [];
  const delegated: string[] = [];
  const ctx: Record<string, any> = makeBaseContext(calls, replies);
  ctx.handleInteraction = async (interaction: Record<string, any>) => {
    delegated.push(interaction.commandName);
    return "delegated";
  };

  gameFilterInteractions(ctx);
  await ctx.handleInteraction(makeSetGamesInteraction("remove", "fortnite"), games);
  const result = await ctx.handleInteraction({
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
