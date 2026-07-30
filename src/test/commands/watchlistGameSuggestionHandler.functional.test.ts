import test from "node:test";
import assert from "node:assert/strict";
import type { GuildAuditLogRecord } from "../../features/admin-records/auditLogRepository.js";

import type { GuildSettings } from "../../features/guild-config/guildSettingsTypes.js";

import installWatchlistGame from "../../features/command-handlers/watchlistGameSuggestionHandler.js";

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

function makeHarness(settings: GuildSettings | null, adminAllowed = true, cooldownAllowed = true) {
  const calls: MongoCall[] = [];
  const replies: unknown[] = [];
  const existing = Array.isArray(settings?.watchlistGameSuggestions) ? settings.watchlistGameSuggestions : [];
  const auditDocs: GuildAuditLogRecord[] = [];
  const handler = installWatchlistGame.createWatchlistGameSuggestionHandler({
    GuildAuditLogModel: {
      create: async (doc: GuildAuditLogRecord) => { auditDocs.push(doc); return doc; },
      find: () => { const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] }; return chain; }
    },
    GuildModel: {
      updateOne: async (filter, update, options) => {
        calls.push({ filter, update, options });
        return { matchedCount: 1, modifiedCount: 1 };
      },
      findOneAndUpdate: async (filter, update, options) => {
        calls.push({ filter, update, options });
        return { watchlistGameSuggestions: existing };
      }
    },
    getGuildSettings: async () => settings,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); return payload; },
    enforceCooldown: async () => cooldownAllowed,
    requireGuildAdmin: async () => adminAllowed,
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });
  return { handler, calls, replies, auditDocs };
}

test("/watchlist-game add salveaza jocul propus normalizat", async () => {
  const { handler, calls, replies } = makeHarness({ _id: "guild-1" });

  await handler.handleWatchlistGameSuggestion(makeInteraction("add", { game: "  Hollow   Knight Silksong " }));

  assert.equal(calls.length, 1);
  assert.match(JSON.stringify(calls[0].update), /watchlistGameSuggestions/);
  assert.match(JSON.stringify(calls[0].update), /hollow knight silksong/);
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
  const { handler, calls, replies, auditDocs } = makeHarness({ _id: "guild-1" }, true);

  await handler.handleWatchlistGameSuggestion(makeInteraction("delete", { game: " Silksong " }));

  const deleteUpdate = calls[0].update as { $pull?: Record<string, unknown>; $push?: Record<string, unknown> };
  assert.deepEqual(deleteUpdate.$pull, { watchlistGameSuggestions: { gameName: "silksong" } });
  assert.equal(deleteUpdate.$push, undefined, "auditul nu mai e $push pe documentul guild");
  const serverAudit = auditDocs.find(doc => doc.kind === "server");
  assert.equal(serverAudit?.action, "watchlist_game_delete");
  const botAudit = auditDocs.find(doc => doc.kind === "bot" && String(doc.details || "").includes("stearsa"));
  assert.equal(botAudit?.command, "/watchlist-game delete", "stergerea propunerii (admin runtime pe comanda publica) intra in /bot-log");
  assert.match(String(botAudit?.details), /stearsa: silksong/);
  assert.match(String(replies[0]), /silksong/);
});

test("/watchlist-game delete nu modifica lista daca runtime admin guard refuza, dar auditeaza refuzul (R[Medium] #3)", async () => {
  const { handler, calls, replies, auditDocs } = makeHarness({ _id: "guild-1" }, false);

  const result = await handler.handleWatchlistGameSuggestion(makeInteraction("delete", { game: "silksong" }));

  assert.equal(result, undefined);
  assert.deepEqual(replies, []);
  assert.equal(calls.length, 0, "niciun $pull pe lista; refuzul merge doar in colectia de audit");
  assert.equal(auditDocs[0]?.command, "/watchlist-game delete");
  assert.equal(auditDocs[0]?.result, "Access denied.");
});

test("/watchlist-game add deduplica: jocul deja propus nu se adauga din nou (R[Medium] #2)", async () => {
  const { handler, replies } = makeHarness({
    _id: "guild-1",
    watchlistGameSuggestions: [{ gameName: "silksong", createdBy: "u2", createdAt: new Date() }]
  });
  await handler.handleWatchlistGameSuggestion(makeInteraction("add", { game: " Silksong " }));
  assert.match(String(replies[0]), /deja in lista/, "jocul existent (normalizat identic) nu se dubleaza");
});

test("/watchlist-game add respecta cooldown-ul per user (R[Medium] #2)", async () => {
  const { handler, calls, replies } = makeHarness({ _id: "guild-1" }, true, false);
  const result = await handler.handleWatchlistGameSuggestion(makeInteraction("add", { game: "silksong" }));
  assert.equal(result, undefined);
  assert.deepEqual(calls, [], "cooldown activ => nicio scriere in DB");
  assert.deepEqual(replies, []);
});
