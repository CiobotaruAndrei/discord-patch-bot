import test from "node:test";
import { installCommandChain, type ChainableCommandModule } from "./commandChainTestKit";
import assert from "node:assert/strict";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";
process.env.METRICS_PUBLIC ||= "true";

type UpdateCall = {
  filter: unknown;
  update: unknown;
  options?: unknown;
};
type Game = { key: string; name: string };
type GameFilterRuntime = {
  handleSetGames: (interaction: unknown, games: Game[], sub: string, guildId: string) => Promise<unknown>;
  handleSetGamesInteraction: (interaction: unknown, games: Game[]) => Promise<unknown>;
};

const installGameFilterHandlers = require("../features/command-handlers/gameFilterHandlers") as ChainableCommandModule;

const games = [
  { key: "cs2", name: "Counter-Strike 2" },
  { key: "fortnite", name: "Fortnite" }
];

function buildContext() {
  const calls: UpdateCall[] = [];
  const replies: unknown[] = [];
  const invalidatedGuilds: string[] = [];
  const context = {
    GuildModel: {
      updateOne: async (filter: unknown, update: unknown, options?: unknown) => {
        calls.push({ filter, update, options });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    invalidateGuildCache: (guildId: string) => {
      invalidatedGuilds.push(guildId);
    },
    safeEdit: async (_interaction: unknown, payload: unknown) => {
      replies.push(payload);
      return payload;
    },
    formatUserError: (_err: unknown, fallback: string) => fallback,
    getGuildSettings: async () => ({ enabledGames: [] }),
    safeDefer: async () => undefined
  };
  installCommandChain(context, [installGameFilterHandlers]);
  return { context: context as typeof context & GameFilterRuntime, calls, replies, invalidatedGuilds };
}

function makeInteraction(gameKey: string | null) {
  return {
    options: {
      getString: (name: string) => name === "joc" ? gameKey : null
    }
  };
}

test("/set games add builds the expected Mongo update and confirmation", async () => {
  const { context, calls, replies, invalidatedGuilds } = buildContext();

  await context.handleSetGames(makeInteraction("cs2"), games, "add", "guild-1");

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].filter, { _id: "guild-1" });
  assert.deepEqual(calls[0].update, { $addToSet: { enabledGames: "cs2" } });
  assert.deepEqual(calls[0].options, { upsert: true });
  assert.deepEqual(invalidatedGuilds, ["guild-1"]);
  assert.equal(replies[0], "OK: **Counter-Strike 2** adaugat in watchlist.");
});

test("/set games add rejects unknown game keys before writing", async () => {
  const { context, calls, replies, invalidatedGuilds } = buildContext();

  await context.handleSetGames(makeInteraction("unknown"), games, "add", "guild-1");

  assert.equal(calls.length, 0);
  assert.deepEqual(invalidatedGuilds, []);
  assert.match(String(replies[0]), /Cheia `unknown` nu exista/);
});

test("/set games remove builds the expected pull update", async () => {
  const { context, calls, replies, invalidatedGuilds } = buildContext();

  await context.handleSetGames(makeInteraction("fortnite"), games, "remove", "guild-2");

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].filter, { _id: "guild-2" });
  assert.deepEqual(calls[0].update, { $pull: { enabledGames: "fortnite" } });
  assert.equal(calls[0].options, undefined);
  assert.deepEqual(invalidatedGuilds, ["guild-2"]);
  assert.equal(replies[0], "OK: **Fortnite** scos din watchlist.");
});

test("/set add games (structura noua: verb-grup) ruteaza la add", async () => {
  const { context, calls, replies } = buildContext();
  const interaction = {
    guild: { id: "guild-1" },
    options: {
      getSubcommandGroup: (_required: false) => "add",
      getSubcommand: () => "games",
      getString: (name: string) => name === "joc" ? "cs2" : null
    }
  };
  await context.handleSetGamesInteraction(interaction, games);
  assert.deepEqual(calls[0].update, { $addToSet: { enabledGames: "cs2" } }, "/set add games adauga jocul (verbul din grup, nu din subcomanda)");
  assert.equal(replies[0], "OK: **Counter-Strike 2** adaugat in watchlist.");
});

test("/set remove games (structura noua) ruteaza la remove", async () => {
  const { context, calls } = buildContext();
  const interaction = {
    guild: { id: "guild-1" },
    options: {
      getSubcommandGroup: (_required: false) => "remove",
      getSubcommand: () => "games",
      getString: (name: string) => name === "joc" ? "cs2" : null
    }
  };
  await context.handleSetGamesInteraction(interaction, games);
  assert.deepEqual(calls[0].update, { $pull: { enabledGames: "cs2" } }, "/set remove games scoate jocul");
});

test("/set games reset (verbul ramane subcomanda) inca merge", async () => {
  const { context, calls } = buildContext();
  const interaction = {
    guild: { id: "guild-1" },
    options: {
      getSubcommandGroup: (_required: false) => "games",
      getSubcommand: () => "reset",
      getString: () => null
    }
  };
  await context.handleSetGamesInteraction(interaction, games);
  assert.deepEqual(calls[0].update, { $set: { enabledGames: [] } }, "reset ramane sub grupul games");
});
