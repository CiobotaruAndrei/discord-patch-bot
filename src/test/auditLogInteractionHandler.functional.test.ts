import test from "node:test";
import assert from "node:assert/strict";

import type { GuildAuditLogRecord } from "../features/admin-records/auditLogRepository";

const installAuditLog = require("../features/command-handlers/auditLogInteractionHandler") as typeof import("../features/command-handlers/auditLogInteractionHandler");

function makeAuditModel(seed: GuildAuditLogRecord[]) {
  const docs = [...seed];
  return {
    create: async (doc: GuildAuditLogRecord) => { docs.push(doc); return doc; },
    find(filter: Record<string, unknown>) {
      let results = docs.filter(doc => doc.guildId === filter.guildId && doc.kind === filter.kind);
      const range = filter.at as { $gte: Date; $lt: Date } | undefined;
      if (range) {
        results = results.filter(doc => {
          const at = new Date(doc.at ?? 0).getTime();
          return at >= range.$gte.getTime() && at < range.$lt.getTime();
        });
      }
      let skipCount = 0;
      let limitCount = results.length;
      const chain = {
        sort(spec: Record<string, 1 | -1>) {
          const direction = spec.at === -1 ? -1 : 1;
          results = [...results].sort((a, b) => direction * (new Date(a.at ?? 0).getTime() - new Date(b.at ?? 0).getTime()));
          return chain;
        },
        skip(count: number) { skipCount = count; return chain; },
        limit(count: number) { limitCount = count; return chain; },
        lean: async () => results.slice(skipCount, skipCount + limitCount)
      };
      return chain;
    }
  };
}

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

test("/server-log render escapeaza mentiunile, backtick-urile si newline-urile din detalii persistate (R[Low-Medium] #3)", () => {
  const text = installAuditLog.renderServerLog([
    {
      userId: "user-1",
      action: "backup_load",
      details: "ping <@999> si <@&777> cu `cod` injectat\na doua linie",
      serverId: "guild-1",
      at: "2025-01-01T00:00:00.000Z"
    }
  ]);

  assert.match(text, /<@user-1>/, "mentiunea autorului auditului (controlata de bot) ramane");
  assert.doesNotMatch(text, /<@999>/, "mentiunea de user injectata in detalii e neutralizata (escapata)");
  assert.doesNotMatch(text, /<@&777>/, "mentiunea de rol injectata e neutralizata");
  assert.match(text, /\\@999/, "caracterul @ din detalii e escapat cu backslash");
  assert.match(text, /a doua linie/, "newline-ul din detalii e colapsat, nu rupe randul auditului");
  const detailsLine = text.split("\n").find(line => line.includes("a doua linie"));
  assert.ok(detailsLine && detailsLine.includes("backup_load"), "detaliile multi-linie raman pe acelasi rand cu actiunea");
});

test("/bot-log handler trimite payload cu allowedMentions golit (NO_MENTIONS), nu string brut (R[Low-Medium] #3)", async () => {
  const model = makeAuditModel([
    { guildId: "guild-1", kind: "bot", userId: "user-1", command: "/set mode", result: "Access granted. <@everyone>", at: new Date("2025-01-01T00:00:00.000Z") }
  ]);
  const payloads: Array<Record<string, unknown>> = [];
  const handler = installAuditLog.createAuditLogInteractionHandler({
    GuildAuditLogModel: model,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { payloads.push(payload as Record<string, unknown>); return payload; },
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
      getSubcommand: () => "recent",
      getInteger: () => null,
      getString: () => null
    },
    reply: async payload => payload,
    followUp: async payload => payload
  });

  assert.equal(payloads.length, 1);
  const payload = payloads[0];
  assert.equal(typeof payload.content, "string", "se trimite un payload-obiect, nu un string brut");
  assert.deepEqual(payload.allowedMentions, { parse: [] }, "allowedMentions blocheaza orice mentiune din continutul persistat");
  assert.doesNotMatch(String(payload.content), /<@everyone>/, "mentiunea injectata in rezultat e escapata in continut");
});

test("/bot-log older filtreaza pe luna si afiseaza hint pentru lotul urmator", async () => {
  const entries: GuildAuditLogRecord[] = Array.from({ length: 25 }, (_value, index) => ({
    guildId: "guild-1",
    kind: "bot" as const,
    userId: `user-${index}`,
    command: "/set mode",
    result: "Access granted.",
    at: new Date(`2025-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`)
  }));
  const model = makeAuditModel([
    ...entries,
    { guildId: "guild-1", kind: "bot", userId: "old", command: "/set mode", result: "Access granted.", at: new Date("2025-07-01T00:00:00.000Z") }
  ]);
  const replies: unknown[] = [];
  const handler = installAuditLog.createAuditLogInteractionHandler({
    GuildAuditLogModel: model,
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

  const text = String((replies[0] as { content?: unknown }).content ?? replies[0]);
  assert.match(text, /Interval 2025-08/);
  assert.match(text, /Bot log \(25\)/);
  assert.match(text, /offset:25/);
  assert.doesNotMatch(text, /old/);
});
