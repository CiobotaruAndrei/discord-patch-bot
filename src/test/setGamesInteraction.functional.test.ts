import test from "node:test";
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

const attachInteractions = require("../features/commands/interactions") as (ctx: Record<string, unknown>) => void;

const games = [
  { key: "cs2", name: "Counter-Strike 2" },
  { key: "fortnite", name: "Fortnite" }
];

function buildContext() {
  const calls: UpdateCall[] = [];
  const replies: unknown[] = [];
  const invalidatedGuilds: string[] = [];
  const ctx: Record<string, unknown> = {
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
    getGuildSettings: async () => ({ enabledGames: [] })
  };
  attachInteractions(ctx);
  return { ctx, calls, replies, invalidatedGuilds };
}

function makeInteraction(gameKey: string | null) {
  return {
    options: {
      getString: (name: string) => name === "joc" ? gameKey : null
    }
  };
}

test("/set games add builds the expected Mongo update and confirmation", async () => {
  const { ctx, calls, replies, invalidatedGuilds } = buildContext();

  await (ctx.handleSetGames as Function)(makeInteraction("cs2"), games, "add", "guild-1");

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].filter, { _id: "guild-1" });
  assert.deepEqual(calls[0].update, { $addToSet: { enabledGames: "cs2" } });
  assert.deepEqual(calls[0].options, { upsert: true });
  assert.deepEqual(invalidatedGuilds, ["guild-1"]);
  assert.equal(replies[0], "OK: **Counter-Strike 2** adaugat la lista activa.");
});

test("/set games add rejects unknown game keys before writing", async () => {
  const { ctx, calls, replies, invalidatedGuilds } = buildContext();

  await (ctx.handleSetGames as Function)(makeInteraction("unknown"), games, "add", "guild-1");

  assert.equal(calls.length, 0);
  assert.deepEqual(invalidatedGuilds, []);
  assert.match(String(replies[0]), /Cheia `unknown` nu exista/);
});

test("/set games remove builds the expected pull update", async () => {
  const { ctx, calls, replies, invalidatedGuilds } = buildContext();

  await (ctx.handleSetGames as Function)(makeInteraction("fortnite"), games, "remove", "guild-2");

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].filter, { _id: "guild-2" });
  assert.deepEqual(calls[0].update, { $pull: { enabledGames: "fortnite" } });
  assert.equal(calls[0].options, undefined);
  assert.deepEqual(invalidatedGuilds, ["guild-2"]);
  assert.equal(replies[0], "OK: **Fortnite** scos din lista activa.");
});
