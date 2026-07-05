import test from "node:test";
import assert from "node:assert/strict";

import type { GuildSettings } from "../types";
import { escapeInlineText } from "../shared/discordText";

const installSuggestCommand = require("../features/command-handlers/suggestCommandInteractionHandler") as typeof import("../features/command-handlers/suggestCommandInteractionHandler");

type MongoCall = {
  filter: Record<string, unknown>;
  update: Record<string, unknown> | Array<Record<string, unknown>>;
  options?: Record<string, unknown>;
};

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

function makeHarness(settings: GuildSettings | null, adminAllowed = true, cooldownAllowed = true) {
  const calls: MongoCall[] = [];
  const replies: unknown[] = [];
  const invalidated: string[] = [];
  const existing = Array.isArray(settings?.suggestedCommands) ? settings.suggestedCommands : [];
  const handler = installSuggestCommand.createSuggestCommandInteractionHandler({
    GuildModel: {
      updateOne: async (filter, update, options) => {
        calls.push({ filter, update, options });
        return { matchedCount: 1, modifiedCount: 1 };
      },
      findOneAndUpdate: async (filter, update, options) => {
        calls.push({ filter, update, options });
        return { suggestedCommands: existing };
      }
    },
    getGuildSettings: async () => settings,
    invalidateGuildCache: guildId => { invalidated.push(guildId); },
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); return payload; },
    enforceCooldown: async () => cooldownAllowed,
    requireGuildAdmin: async () => adminAllowed,
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });
  return { handler, calls, replies, invalidated };
}

test("/suggest-command add salveaza numele normalizat si descrierea propusa", async () => {
  const { handler, calls, replies, invalidated } = makeHarness({ _id: "guild-1" });

  await handler.handleSuggestCommandInteraction(makeInteraction("add", {
    name: "/ calendar   updates ",
    description: "Sa afiseze update-uri programate"
  }));

  assert.equal(calls.length, 1);
  assert.match(JSON.stringify(calls[0].update), /suggestedCommands/);
  assert.match(JSON.stringify(calls[0].update), /calendar updates/);
  assert.deepEqual(invalidated, ["guild-1"]);
  assert.match(String(replies[0]), /calendar updates/);
});

test("/suggest-command list cere admin runtime si afiseaza propunerile", async () => {
  const { handler, replies } = makeHarness({
    _id: "guild-1",
    suggestedCommands: [{
      commandName: "calendar",
      description: "arata calendarul",
      createdBy: "user-2",
      createdAt: new Date()
    }]
  });

  await handler.handleSuggestCommandInteraction(makeInteraction("list", { numar: 10 }));

  const content = String((replies[0] as { content?: string }).content ?? replies[0]);
  assert.match(content, /calendar/);
  assert.match(content, /arata calendarul/);
  assert.match(content, /<@user-2>/);
});

test("/suggest-command list nu afiseaza lista daca runtime admin guard refuza, dar auditeaza refuzul (R[Medium] #3)", async () => {
  const { handler, replies, calls } = makeHarness({ _id: "guild-1" }, false);

  const result = await handler.handleSuggestCommandInteraction(makeInteraction("list"));

  assert.equal(result, undefined);
  assert.deepEqual(replies, []);
  const audit = ((calls[0]?.update as { $push?: { botAuditLog?: { $each?: Array<{ command?: string; result?: string }> } } })?.$push)?.botAuditLog?.$each?.[0];
  assert.equal(audit?.command, "/suggest-command list", "refuzul de acces e scris in /bot-log");
  assert.equal(audit?.result, "Access denied.");
});

test("/suggest-command delete cere admin runtime si sterge sugestia normalizata", async () => {
  const { handler, calls, replies, invalidated } = makeHarness({ _id: "guild-1" }, true);

  await handler.handleSuggestCommandInteraction(makeInteraction("delete", { name: "/ Calendar   Updates " }));

  assert.equal(calls.length, 2, "stergerea (P2): un $pull+audit server-log atomic + un audit /bot-log");
  const deleteUpdate = calls[0].update as { $pull?: Record<string, unknown>; $push?: { serverAuditLog?: { $each?: Array<{ action?: string }> } } };
  assert.deepEqual(deleteUpdate.$pull, { suggestedCommands: { commandName: "calendar updates" } });
  assert.equal(deleteUpdate.$push?.serverAuditLog?.$each?.[0]?.action, "suggest_command_delete", "auditul server-log e in aceeasi scriere cu $pull (R7 #13)");
  const audit = ((calls[1].update as { $push?: { botAuditLog?: { $each?: Array<{ command?: string; result?: string; details?: string }> } } }).$push)?.botAuditLog?.$each?.[0];
  assert.equal(audit?.command, "/suggest-command delete", "stergerea sugestiei (admin runtime pe comanda publica) intra in /bot-log");
  assert.match(String(audit?.details), /stearsa: calendar updates/);
  assert.deepEqual(invalidated, ["guild-1"]);
  assert.match(String(replies[0]), /calendar updates/);
});

test("/suggest-command list escapeaza textul user-provided si dezactiveaza mentiunile (R[P3])", async () => {
  const settings: GuildSettings = {
    _id: "guild-1",
    suggestedCommands: [{
      commandName: "hack",
      description: "`break out` **bold** @everyone <@123>",
      createdBy: "user-1",
      createdAt: new Date()
    }]
  };
  const { handler, replies } = makeHarness(settings, true);
  await handler.handleSuggestCommandInteraction(makeInteraction("list", { numar: 10 }));

  const payload = replies.at(-1) as { content: string; allowedMentions?: unknown };
  assert.equal(typeof payload, "object", "raspunsul e un payload structurat, nu doar string");
  assert.deepEqual(payload.allowedMentions, { parse: [] }, "fara ping-uri (allowedMentions gol)");
  const escaped = escapeInlineText("`break out` **bold** @everyone <@123>", 500);
  assert.ok(payload.content.includes(escaped), "descrierea user-provided e trecuta prin escapeInlineText (backtick/bold/mentiuni neutralizate)");
  assert.ok(!payload.content.includes(" `break out` "), "backtick-urile NU mai apar ne-escapate (nu pot inchide blocul de cod al liniei)");
});

test("/suggest-command list scrie in /bot-log (subcomanda admin sub comanda publica) (R[P2] #3)", async () => {
  const audits: Array<{ command?: string }> = [];
  const settings: GuildSettings = { _id: "guild-1", suggestedCommands: [] };
  const handler = installSuggestCommand.createSuggestCommandInteractionHandler({
    GuildModel: {
      updateOne: async (_filter, update) => {
        const entry = ((update as { $push?: { botAuditLog?: { $each?: Array<{ command?: string }> } } }).$push)?.botAuditLog?.$each?.[0];
        if (entry) audits.push(entry);
        return { matchedCount: 1, modifiedCount: 1 };
      },
      findOneAndUpdate: async () => ({ suggestedCommands: [] })
    },
    getGuildSettings: async () => settings,
    invalidateGuildCache: () => undefined,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => payload,
    enforceCooldown: async () => true,
    requireGuildAdmin: async () => true,
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });
  await handler.handleSuggestCommandInteraction(makeInteraction("list", { numar: 5 }));
  assert.deepEqual(audits.map(a => a.command), ["/suggest-command list"], "subcomanda admin /suggest-command list apare in /bot-log");
});

test("/add suggestion (verb in fata) ruteaza la handleAdd si salveaza propunerea", async () => {
  const { handler, calls, replies, invalidated } = makeHarness({ _id: "guild-1" });
  const verb = {
    ...makeInteraction("suggestion", { name: "/ calendar   updates ", description: "Sa afiseze update-uri programate" }),
    commandName: "add"
  };
  await handler.handleSuggestCommandInteraction(verb);
  assert.equal(calls.length, 1);
  assert.match(JSON.stringify(calls[0].update), /suggestedCommands/, "/add suggestion deriva actiunea add din commandName");
  assert.match(JSON.stringify(calls[0].update), /calendar updates/);
  assert.deepEqual(invalidated, ["guild-1"]);
});

test("/add suggestion deduplica: comanda deja propusa nu se adauga din nou (R[Medium] #2)", async () => {
  const { handler, replies } = makeHarness({
    _id: "guild-1",
    suggestedCommands: [{ commandName: "calendar updates", description: "x", createdBy: "u2", createdAt: new Date() }]
  });
  await handler.handleSuggestCommandInteraction(makeInteraction("add", { name: "/ Calendar   Updates ", description: "alta descriere" }));
  assert.match(String(replies[0]), /deja in lista/, "comanda existenta (normalizata identic) nu se dubleaza");
});

test("/add suggestion respecta cooldown-ul per user (R[Medium] #2)", async () => {
  const { handler, calls, replies } = makeHarness({ _id: "guild-1" }, true, false);
  const result = await handler.handleSuggestCommandInteraction(makeInteraction("add", { name: "calendar", description: "x" }));
  assert.equal(result, undefined);
  assert.deepEqual(calls, [], "cooldown activ => nicio scriere in DB");
  assert.deepEqual(replies, []);
});
