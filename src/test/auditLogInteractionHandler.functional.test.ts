import test from "node:test";
import assert from "node:assert/strict";

import type { GuildSettings } from "../types";

const installAuditLog = require("../features/command-handlers/auditLogInteractionHandler") as typeof import("../features/command-handlers/auditLogInteractionHandler");

test("/bot-log render include rezultatul Access granted si nu creeaza mentiuni invalide pentru user lipsa", () => {
  const text = installAuditLog.renderBotLog([
    {
      userId: "user-1",
      command: "/backup add",
      result: "Access granted.",
      serverId: "guild-1",
      at: "2025-01-01T00:00:00.000Z"
    },
    {
      userId: "",
      command: "/backup load",
      result: "Access denied.",
      serverId: "guild-1",
      at: "2025-01-02T00:00:00.000Z"
    }
  ]);

  assert.match(text, /Access granted\./);
  assert.match(text, /Access denied\./);
  assert.match(text, /<@user-1>/);
  assert.match(text, /user necunoscut/);
  assert.doesNotMatch(text, /<@necunoscut>/);
});

test("/server-log render afiseaza actiunea si detaliile auditului server", () => {
  const text = installAuditLog.renderServerLog([
    {
      userId: "user-1",
      action: "backup_load",
      details: "Loaded backup prod",
      serverId: "guild-1",
      at: "2025-01-01T00:00:00.000Z"
    }
  ]);

  assert.match(text, /backup_load/);
  assert.match(text, /Loaded backup prod/);
  assert.match(text, /<@user-1>/);
});

test("/bot-log older filtreaza pe luna si afiseaza hint pentru lotul urmator", async () => {
  const entries = Array.from({ length: 25 }, (_value, index) => ({
    userId: `user-${index}`,
    command: "/set mode",
    result: "Access granted.",
    serverId: "guild-1",
    at: `2025-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
  }));
  const settings: GuildSettings = {
    _id: "guild-1",
    botAuditLog: [
      ...entries,
      { userId: "old", command: "/set mode", result: "Access granted.", serverId: "guild-1", at: "2025-07-01T00:00:00.000Z" }
    ]
  };
  const replies: unknown[] = [];
  const handler = installAuditLog.createAuditLogInteractionHandler({
    getGuildSettings: async () => settings,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); return payload; },
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });

  await handler.handleAuditLogInteraction({
    commandName: "bot-log",
    guild: { id: "guild-1" },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => "older",
      getInteger: (name: string) => name === "offset" ? 0 : null,
      getString: (name: string) => name === "period" ? "luna" : name === "start" ? "2025-08" : null
    },
    reply: async payload => payload,
    followUp: async payload => payload
  });

  const text = String(replies[0]);
  assert.match(text, /Interval 2025-08/);
  assert.match(text, /Bot log \(25\)/);
  assert.match(text, /offset:25/);
  assert.doesNotMatch(text, /old/);
});
