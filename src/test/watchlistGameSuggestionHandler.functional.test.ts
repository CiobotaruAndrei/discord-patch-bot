import test from "node:test";
import assert from "node:assert/strict";

import type { GuildSettings } from "../types";

const installWatchlistGame = require("../features/command-handlers/watchlistGameSuggestionHandler") as typeof import("../features/command-handlers/watchlistGameSuggestionHandler");

type MongoCall = {
  filter: Record<string, unknown>;
  update: Record<string, unknown> | Record<string, unknown>[];
  options?: Record<string, unknown>;
};

function makeInteraction(subcommand: string, values: { game?: string; numar?: number } = {}) {
  return {
    commandName: "watchlist-game",
    guild: { id: "guild-1" },
    user: { id: "user-1" },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => subcommand,
      getString: (name: string) => name === "game" ? values.game ?? null : null,
      getInteger: (name: string) => name === "numar" ? values.numar ?? null : null
    },
    reply: async (payload: unknown) => payload,
    followUp: async (payload: unknown) => payload
  };
}

function makeHarness(settings: GuildSettings | null, adminAllowed = true) {
  const calls: MongoCall[] = [];
  const replies: unknown[] = [];
  const invalidated: string[] = [];
  const handler = installWatchlistGame.createWatchlistGameSuggestionHandler({
    GuildModel: {
      updateOne: async (filter, update, options) => {
        calls.push({ filter, update, options });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    getGuildSettings: async () => settings,
    invalidateGuildCache: guildId => { invalidated.push(guildId); },
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); return payload; },
    requireGuildAdmin: async () => adminAllowed,
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });
  return { handler, calls, replies, invalidated };
}

test("/watchlist-game add salveaza jocul propus normalizat", async () => {
  const { handler, calls, replies, invalidated } = makeHarness({ _id: "guild-1" });

  await handler.handleWatchlistGameSuggestion(makeInteraction("add", { game: "  Hollow   Knight Silksong " }));

  assert.equal(calls.length, 1);
  assert.match(JSON.stringify(calls[0].update), /watchlistGameSuggestions/);
  assert.match(JSON.stringify(calls[0].update), /hollow knight silksong/);
  assert.deepEqual(invalidated, ["guild-1"]);
  assert.match(String(replies[0]), /hollow knight silksong/);
});

test("/watchlist-game list afiseaza propunerile fara mentiuni active", async () => {
  const { handler, replies } = makeHarness({
    _id: "guild-1",
    watchlistGameSuggestions: [{
      gameName: "silksong",
      createdBy: "user-2",
      createdAt: new Date()
    }]
  });

  await handler.handleWatchlistGameSuggestion(makeInteraction("list", { numar: 10 }));

  const payload = replies[0] as { content?: string; allowedMentions?: unknown };
  assert.match(String(payload.content ?? ""), /silksong/);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test("/watchlist-game delete cere admin runtime si sterge propunerea", async () => {
  const { handler, calls, replies, invalidated } = makeHarness({ _id: "guild-1" }, true);

  await handler.handleWatchlistGameSuggestion(makeInteraction("delete", { game: " Silksong " }));

  assert.deepEqual(calls[0].update, { $pull: { watchlistGameSuggestions: { gameName: "silksong" } } });
  assert.deepEqual(invalidated, ["guild-1"]);
  assert.match(String(replies[0]), /silksong/);
});

test("/watchlist-game delete nu modifica lista daca runtime admin guard refuza", async () => {
  const { handler, calls, replies } = makeHarness({ _id: "guild-1" }, false);

  const result = await handler.handleWatchlistGameSuggestion(makeInteraction("delete", { game: "silksong" }));

  assert.equal(result, undefined);
  assert.deepEqual(calls, []);
  assert.deepEqual(replies, []);
});
