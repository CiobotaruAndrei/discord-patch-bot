import test from "node:test";
import assert from "node:assert/strict";

import type { FutureReleaseGameEntry, GuildSettings } from "../../types.js";

import installFutureRelease from "../../features/command-handlers/futureReleaseInteractionHandler.js";

type MongoCall = {
  filter: Record<string, unknown>;
  update: Record<string, unknown> | Record<string, unknown>[];
  options?: Record<string, unknown>;
};

function recordFromPipeline(update: unknown): FutureReleaseGameEntry {
  const stage = (Array.isArray(update) ? update[0] : undefined) as { $set?: { futureReleaseGames?: { $let?: { in?: { $cond?: unknown[] } } } } } | undefined;
  const cond = stage?.$set?.futureReleaseGames?.$let?.in?.$cond as Array<{ $concatArrays?: unknown[] }> | undefined;
  const appended = cond?.[1]?.$concatArrays?.[1] as FutureReleaseGameEntry[] | undefined;
  return appended?.[0] ?? { gameName: "", addedBy: "", addedAt: new Date() };
}

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
  const deferModes: boolean[] = [];
  const existingGames: FutureReleaseGameEntry[] = Array.isArray(settings?.futureReleaseGames) ? settings.futureReleaseGames : [];
  const handler = installFutureRelease.createFutureReleaseInteractionHandler({
    GuildModel: {
      updateOne: async (filter, update, options) => {
        calls.push({ filter, update, options });
        return { matchedCount: 1, modifiedCount: 1 };
      },
      findOneAndUpdate: async (filter, update, options) => {
        calls.push({ filter, update, options });
        const record = recordFromPipeline(update);
        const kept = existingGames.filter(game => game.gameName !== record.gameName);
        const futureReleaseGames = kept.length < 20 ? [...kept, record] : kept;
        return { futureReleaseGames };
      }
    },
    getGuildSettings: async () => settings,
    safeDefer: async (_interaction, ephemeral) => { deferModes.push(ephemeral === true); },
    safeEdit: async (_interaction, payload) => { replies.push(payload); return payload; },
    canSendEmbeds: () => true,
    listMissingChannelPerms: () => [],
    missingChannelPermsMessage: () => "lipsesc permisiuni",
    checkChannelPermissions: async () => ({ sendMessages: true, embedLinks: true, readMessageHistory: true }),
    makeActivationId: () => "activation-1",
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });
  return { handler, calls, replies, deferModes };
}

test("/future-release add salveaza jocul cu data si pretul de preorder", async () => {
  const { handler, calls, replies } = makeHarness({ _id: "guild-1", futureReleaseGames: [] });

  await handler.handleFutureRelease(makeInteraction("add", {
    game: " Silksong ",
    releaseDate: "2026",
    preorderPrice: "indisponibil"
  }));

  assert.equal(calls.length, 1, "salvarea atomica foloseste un singur findOneAndUpdate cu pipeline");
  assert.ok(Array.isArray(calls[0].update), "update-ul e un aggregation pipeline atomic");
  assert.match(JSON.stringify(calls[0].update), /futureReleaseGames/);
  assert.match(JSON.stringify(calls[0].update), /silksong/);
  assert.match(String(replies[0]), /silksong/);
});

test("/future-release list afiseaza canalul cand modulul e activ", async () => {
  const games = [{ gameName: "silksong", addedBy: "admin", addedAt: new Date() }];
  const { handler, replies, deferModes } = makeHarness({ _id: "guild-1", futureReleaseGames: games, futureReleaseSubscribed: true, futureReleaseChannelId: "chan-9" });
  await handler.handleFutureRelease(makeInteraction("list"));
  const content = String((replies[0] as { content?: string }).content ?? replies[0]);
  assert.match(content, /ON in <#chan-9>/);
  assert.deepEqual(deferModes, [false], "listarea publica nu este ephemeral");
});

test("/future-release list semnaleaza canal lipsa cand modulul e activ fara canal", async () => {
  const games = [{ gameName: "silksong", addedBy: "admin", addedAt: new Date() }];
  const { handler, replies } = makeHarness({ _id: "guild-1", futureReleaseGames: games, futureReleaseSubscribed: true });
  await handler.handleFutureRelease(makeInteraction("list"));
  const content = String((replies[0] as { content?: string }).content ?? replies[0]);
  assert.doesNotMatch(content, /<#undefined>/, "nu afiseaza canal invalid");
  assert.match(content, /canalul lipseste/);
  assert.match(content, /\/future-release start/);
});

test("/future-release list arata OFF cand modulul e oprit", async () => {
  const games = [{ gameName: "silksong", addedBy: "admin", addedAt: new Date() }];
  const { handler, replies } = makeHarness({ _id: "guild-1", futureReleaseGames: games });
  await handler.handleFutureRelease(makeInteraction("list"));
  const content = String((replies[0] as { content?: string }).content ?? replies[0]);
  assert.match(content, /Notificari: OFF/);
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
  const { handler, calls, replies, deferModes } = makeHarness({ _id: "guild-1" });

  await handler.handleFutureRelease(makeInteraction("start"));

  assert.ok(Array.isArray(calls[0].update), "activarea si resetarea baseline-ului folosesc un singur pipeline atomic");
  const update = JSON.stringify(calls[0].update);
  assert.match(update, /futureReleaseSubscribed/);
  assert.match(update, /futureReleaseChannelId/);
  assert.match(update, /futureReleaseActivationId/);
  assert.match(update, /futureReleaseGames/);
  assert.match(String(replies[0]), /future-release este activ/);
  assert.deepEqual(deferModes, [true], "operatia admin ramane ephemeral");
});

test("/future-release stop opreste modulul si curata activarea", async () => {
  const { handler, calls, replies } = makeHarness({ _id: "guild-1" });

  await handler.handleFutureRelease(makeInteraction("stop"));

  assert.deepEqual(calls[0].update, {
    $set: {
      futureReleaseSubscribed: false,
      futureReleaseChannelId: null,
      futureReleaseInitializing: false
    },
    $unset: { futureReleaseActivationId: "" }
  });
  assert.match(String(replies[0]), /oprite/);
});
