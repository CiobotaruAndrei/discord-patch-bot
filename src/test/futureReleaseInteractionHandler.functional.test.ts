import test from "node:test";
import assert from "node:assert/strict";

import type { GuildSettings } from "../types";

const installFutureRelease = require("../features/command-handlers/futureReleaseInteractionHandler") as typeof import("../features/command-handlers/futureReleaseInteractionHandler");

type MongoCall = {
  filter: Record<string, unknown>;
  update: Record<string, unknown> | Record<string, unknown>[];
  options?: Record<string, unknown>;
};

function makeInteraction(subcommand: string, values: { game?: string; releaseDate?: string; preorderPrice?: string } = {}) {
  return {
    commandName: "future-release",
    guild: { id: "guild-1" },
    channel: { id: "channel-1" },
    client: { user: { id: "bot-1" } },
    user: { id: "admin-1" },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => subcommand,
      getString: (name: string) => {
        if (name === "game") return values.game ?? null;
        if (name === "release-date") return values.releaseDate ?? null;
        if (name === "preorder-price") return values.preorderPrice ?? null;
        return null;
      }
    },
    reply: async (payload: unknown) => payload,
    followUp: async (payload: unknown) => payload
  };
}

function makeHarness(settings: GuildSettings | null) {
  const calls: MongoCall[] = [];
  const replies: unknown[] = [];
  const invalidated: string[] = [];
  const handler = installFutureRelease.createFutureReleaseInteractionHandler({
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
    canSendEmbeds: () => true,
    listMissingChannelPerms: () => [],
    missingChannelPermsMessage: () => "lipsesc permisiuni",
    checkChannelPermissions: async () => ({ sendMessages: true, embedLinks: true, readMessageHistory: true }),
    makeActivationId: () => "activation-1",
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });
  return { handler, calls, replies, invalidated };
}

test("/future-release add salveaza jocul cu data si pretul de preorder", async () => {
  const { handler, calls, replies, invalidated } = makeHarness({ _id: "guild-1", futureReleaseGames: [] });

  await handler.handleFutureRelease(makeInteraction("add", {
    game: " Silksong ",
    releaseDate: "2026",
    preorderPrice: "indisponibil"
  }));

  assert.equal(calls.length, 2);
  assert.match(JSON.stringify(calls[1].update), /futureReleaseGames/);
  assert.match(JSON.stringify(calls[1].update), /silksong/);
  assert.deepEqual(invalidated, ["guild-1"]);
  assert.match(String(replies[0]), /silksong/);
});

test("/future-release add refuza al 21-lea joc nou", async () => {
  const games = Array.from({ length: 20 }, (_value, index) => ({
    gameName: `game-${index}`,
    addedBy: "admin",
    addedAt: new Date()
  }));
  const { handler, calls, replies } = makeHarness({ _id: "guild-1", futureReleaseGames: games });

  await handler.handleFutureRelease(makeInteraction("add", { game: "game-21" }));

  assert.deepEqual(calls, []);
  assert.match(String(replies[0]), /maxim 20/);
});

test("/future-release start salveaza canalul curent si activarea", async () => {
  const { handler, calls, replies, invalidated } = makeHarness({ _id: "guild-1" });

  await handler.handleFutureRelease(makeInteraction("start"));

  assert.deepEqual(calls[0].update, {
    $set: {
      futureReleaseSubscribed: true,
      futureReleaseChannelId: "channel-1",
      futureReleaseInitializing: false,
      futureReleaseActivationId: "activation-1"
    }
  });
  assert.deepEqual(invalidated, ["guild-1"]);
  assert.match(String(replies[0]), /future-release este activ/);
});

test("/future-release stop opreste modulul si curata activarea", async () => {
  const { handler, calls, replies, invalidated } = makeHarness({ _id: "guild-1" });

  await handler.handleFutureRelease(makeInteraction("stop"));

  assert.deepEqual(calls[0].update, {
    $set: {
      futureReleaseSubscribed: false,
      futureReleaseChannelId: null,
      futureReleaseInitializing: false
    },
    $unset: { futureReleaseActivationId: "" }
  });
  assert.deepEqual(invalidated, ["guild-1"]);
  assert.match(String(replies[0]), /oprite/);
});
