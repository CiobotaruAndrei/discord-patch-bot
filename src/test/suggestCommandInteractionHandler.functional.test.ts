import test from "node:test";
import assert from "node:assert/strict";
import type { GuildAuditLogRecord } from "../features/admin-records/auditLogRepository";
import type { GuildSuggestedCommandRecord } from "../features/admin-records/suggestedCommandsRepository";

import { escapeInlineText } from "../shared/discordText";

import installSuggestCommand from "../features/command-handlers/suggestCommandInteractionHandler";

function makeInteraction(subcommand: string, values: { name?: string; description?: string; numar?: number } = {}) {
  return {
    commandName: "suggest-command",
    guild: { id: "guild-1" },
    user: { id: "user-1" },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => subcommand,
      getString: (name: string) => {
        if (name === "name") return values.name ?? null;
        if (name === "description") return values.description ?? null;
        return null;
      },
      getInteger: (name: string) => name === "numar" ? values.numar ?? null : null
    },
    reply: async (payload: unknown) => payload,
    followUp: async (payload: unknown) => payload
  };
}

function makeSuggestedCommandModel(initial: GuildSuggestedCommandRecord[] = []) {
  const docs: GuildSuggestedCommandRecord[] = [...initial];
  const model = {
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>) => {
      const existing = docs.find(doc => doc.guildId === filter.guildId && doc.commandName === filter.commandName);
      if (existing) return { matchedCount: 1, modifiedCount: 0, upsertedCount: 0 };
      if (options?.upsert === true) {
        const setOnInsert = (update.$setOnInsert ?? {}) as Partial<GuildSuggestedCommandRecord>;
        docs.push({ guildId: String(filter.guildId), commandName: String(filter.commandName), ...setOnInsert });
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    },
    deleteOne: async (filter: Record<string, unknown>) => {
      const index = docs.findIndex(doc => doc.guildId === filter.guildId && doc.commandName === filter.commandName);
      if (index < 0) return { deletedCount: 0 };
      docs.splice(index, 1);
      return { deletedCount: 1 };
    },
    deleteMany: async () => ({ deletedCount: 0 }),
    find: (filter: Record<string, unknown>) => {
      let sorted = docs.filter(doc => doc.guildId === filter.guildId);
      let skipped = 0;
      let limited = Number.POSITIVE_INFINITY;
      const chain = {
        sort: () => {
          sorted = [...sorted].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
          return chain;
        },
        skip: (count: number) => { skipped = count; return chain; },
        limit: (count: number) => { limited = count; return chain; },
        lean: async () => sorted.slice(skipped, skipped + limited)
      };
      return chain;
    }
  };
  return { model, docs };
}

function makeHarness(initialSuggestions: GuildSuggestedCommandRecord[] = [], adminAllowed = true, cooldownAllowed = true) {
  const replies: unknown[] = [];
  const auditDocs: GuildAuditLogRecord[] = [];
  const { model, docs } = makeSuggestedCommandModel(initialSuggestions);
  const handler = installSuggestCommand.createSuggestCommandInteractionHandler({
    GuildAuditLogModel: {
      create: async (doc: GuildAuditLogRecord) => { auditDocs.push(doc); return doc; },
      find: () => { const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] }; return chain; }
    },
    GuildSuggestedCommandModel: model,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); return payload; },
    enforceCooldown: async () => cooldownAllowed,
    requireGuildAdmin: async () => adminAllowed,
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });
  return { handler, replies, auditDocs, suggestionDocs: docs };
}

test("/suggest-command add salveaza numele normalizat si descrierea in colectia guildSuggestedCommands", async () => {
  const { handler, replies, suggestionDocs } = makeHarness();

  await handler.handleSuggestCommandInteraction(makeInteraction("add", {
    name: "/ calendar   updates ",
    description: "Sa afiseze update-uri programate"
  }));

  assert.equal(suggestionDocs.length, 1, "sugestia e un document in colectia dedicata, nu pe documentul guild");
  assert.equal(suggestionDocs[0].guildId, "guild-1");
  assert.equal(suggestionDocs[0].commandName, "calendar updates");
  assert.equal(suggestionDocs[0].description, "Sa afiseze update-uri programate");
  assert.match(String(replies[0]), /calendar updates/);
});

test("/suggest-command list cere admin runtime si afiseaza propunerile din colectie", async () => {
  const { handler, replies } = makeHarness([{
    guildId: "guild-1",
    commandName: "calendar",
    description: "arata calendarul",
    createdBy: "user-2",
    createdAt: new Date()
  }]);

  await handler.handleSuggestCommandInteraction(makeInteraction("list", { numar: 10 }));

  const content = String((replies[0] as { content?: string }).content ?? replies[0]);
  assert.match(content, /calendar/);
  assert.match(content, /arata calendarul/);
  assert.match(content, /<@user-2>/);
});

test("/suggest-command list nu afiseaza lista daca runtime admin guard refuza, dar auditeaza refuzul (R[Medium] #3)", async () => {
  const { handler, replies, auditDocs } = makeHarness([], false);

  const result = await handler.handleSuggestCommandInteraction(makeInteraction("list"));

  assert.equal(result, undefined);
  assert.deepEqual(replies, []);
  assert.equal(auditDocs[0]?.command, "/suggest-command list", "refuzul de acces e scris in /bot-log");
  assert.equal(auditDocs[0]?.result, "Access denied.");
});

test("/suggest-command delete cere admin runtime si sterge sugestia normalizata din colectie", async () => {
  const { handler, replies, auditDocs, suggestionDocs } = makeHarness([{
    guildId: "guild-1",
    commandName: "calendar updates",
    description: "x",
    createdBy: "user-2",
    createdAt: new Date()
  }]);

  await handler.handleSuggestCommandInteraction(makeInteraction("delete", { name: "/ Calendar   Updates " }));

  assert.equal(suggestionDocs.length, 0, "stergerea = deleteOne pe cheia naturala (guildId, nume normalizat)");
  const serverAudit = auditDocs.find(doc => doc.kind === "server");
  assert.equal(serverAudit?.action, "suggest_command_delete");
  const botAudit = auditDocs.find(doc => doc.kind === "bot" && String(doc.details || "").includes("stearsa"));
  assert.equal(botAudit?.command, "/suggest-command delete", "stergerea sugestiei (admin runtime pe comanda publica) intra in /bot-log");
  assert.match(String(botAudit?.details), /stearsa: calendar updates/);
  assert.match(String(replies[0]), /calendar updates/);
});

test("/suggest-command list escapeaza textul user-provided si dezactiveaza mentiunile (R[P3])", async () => {
  const { handler, replies } = makeHarness([{
    guildId: "guild-1",
    commandName: "hack",
    description: "`break out` **bold** @everyone <@123>",
    createdBy: "user-1",
    createdAt: new Date()
  }]);
  await handler.handleSuggestCommandInteraction(makeInteraction("list", { numar: 10 }));

  const payload = replies.at(-1) as { content: string; allowedMentions?: unknown };
  assert.equal(typeof payload, "object", "raspunsul e un payload structurat, nu doar string");
  assert.deepEqual(payload.allowedMentions, { parse: [] }, "fara ping-uri (allowedMentions gol)");
  const escaped = escapeInlineText("`break out` **bold** @everyone <@123>", 500);
  assert.ok(payload.content.includes(escaped), "descrierea user-provided e trecuta prin escapeInlineText (backtick/bold/mentiuni neutralizate)");
  assert.ok(!payload.content.includes(" `break out` "), "backtick-urile NU mai apar ne-escapate (nu pot inchide blocul de cod al liniei)");
});

test("/suggest-command list scrie in /bot-log (subcomanda admin sub comanda publica) (R[P2] #3)", async () => {
  const { handler, auditDocs } = makeHarness();
  await handler.handleSuggestCommandInteraction(makeInteraction("list", { numar: 5 }));
  assert.deepEqual(auditDocs.map(doc => String(doc.command || "")), ["/suggest-command list"], "subcomanda admin /suggest-command list apare in /bot-log");
});

test("/add suggestion (verb in fata) ruteaza la handleAdd si salveaza propunerea in colectie", async () => {
  const { handler, suggestionDocs } = makeHarness();
  const verb = {
    ...makeInteraction("suggestion", { name: "/ calendar   updates ", description: "Sa afiseze update-uri programate" }),
    commandName: "add"
  };
  await handler.handleSuggestCommandInteraction(verb);
  assert.equal(suggestionDocs.length, 1, "/add suggestion deriva actiunea add din commandName");
  assert.equal(suggestionDocs[0].commandName, "calendar updates");
});

test("/add suggestion deduplica: comanda deja propusa nu se adauga din nou si nu e rescrisa (R[Medium] #2)", async () => {
  const { handler, replies, suggestionDocs } = makeHarness([{
    guildId: "guild-1",
    commandName: "calendar updates",
    description: "x",
    createdBy: "u2",
    createdAt: new Date()
  }]);
  await handler.handleSuggestCommandInteraction(makeInteraction("add", { name: "/ Calendar   Updates ", description: "alta descriere" }));
  assert.match(String(replies[0]), /deja in lista/, "comanda existenta (normalizata identic) nu se dubleaza");
  assert.equal(suggestionDocs.length, 1);
  assert.equal(suggestionDocs[0].description, "x", "propunerea duplicata nu rescrie intrarea originala");
});

test("/add suggestion respecta cooldown-ul per user (R[Medium] #2)", async () => {
  const { handler, replies, suggestionDocs } = makeHarness([], true, false);
  const result = await handler.handleSuggestCommandInteraction(makeInteraction("add", { name: "calendar", description: "x" }));
  assert.equal(result, undefined);
  assert.deepEqual(suggestionDocs, [], "cooldown activ => nicio scriere in DB");
  assert.deepEqual(replies, []);
});
