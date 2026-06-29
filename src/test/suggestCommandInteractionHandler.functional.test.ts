import test from "node:test";
import assert from "node:assert/strict";

import type { GuildSettings } from "../types";
import { escapeInlineText } from "../shared/discordText";

const installSuggestCommand = require("../features/command-handlers/suggestCommandInteractionHandler") as typeof import("../features/command-handlers/suggestCommandInteractionHandler");

type MongoCall = {
  filter: Record<string, unknown>;
  update: Record<string, unknown>;
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

function makeHarness(settings: GuildSettings | null, adminAllowed = true) {
  const calls: MongoCall[] = [];
  const replies: unknown[] = [];
  const invalidated: string[] = [];
  const handler = installSuggestCommand.createSuggestCommandInteractionHandler({
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

test("/suggest-command list nu afiseaza lista daca runtime admin guard refuza", async () => {
  const { handler, replies } = makeHarness({ _id: "guild-1" }, false);

  const result = await handler.handleSuggestCommandInteraction(makeInteraction("list"));

  assert.equal(result, undefined);
  assert.deepEqual(replies, []);
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
