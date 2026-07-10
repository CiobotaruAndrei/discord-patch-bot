import test from "node:test";
import assert from "node:assert/strict";
import type { GuildAuditLogRecord } from "../features/admin-records/auditLogRepository";

import {
  buildReportAlertBody,
  buildReportConfirmEmbed,
  buildReportListEmbed,
  type ReportRecord
} from "../features/command-handlers/reportViews";

const mod = require("../features/command-handlers/reportInteractionHandler") as typeof import("../features/command-handlers/reportInteractionHandler");

const base: ReportRecord = { guildId: "g1", userId: "u1", type: "sursa-stricata", gameKey: "minecraft", detail: "Nu mai vin update-uri de 2 saptamani", createdAt: new Date() };

test("buildReportConfirmEmbed multumeste si reda tipul + detaliile", () => {
  const embed = buildReportConfirmEmbed(base);
  assert.match(embed.title, /Multumesc/);
  assert.match(embed.description, /Sursa stricata/);
  assert.match(embed.description, /minecraft/);
  assert.match(embed.description, /Nu mai vin update-uri/);
  assert.equal(embed.color, 0x2ecc71);
});

test("buildReportConfirmEmbed omite joc/detalii cand lipsesc", () => {
  const embed = buildReportConfirmEmbed({ ...base, gameKey: "", detail: "" });
  assert.doesNotMatch(embed.description, /Joc:/);
  assert.doesNotMatch(embed.description, /Detalii:/);
});

test("buildReportAlertBody include server, utilizator, tip, joc si detalii", () => {
  const body = buildReportAlertBody(base);
  assert.match(body, /Server: g1/);
  assert.match(body, /Utilizator: u1/);
  assert.match(body, /Tip: Sursa stricata/);
  assert.match(body, /Joc: minecraft/);
  assert.match(body, /Detalii: Nu mai vin update-uri/);
});

test("buildReportListEmbed include id-urile si statusul rapoartelor", () => {
  const embed = buildReportListEmbed([
    { ...base, id: "64a1f2b3c4d5e6f789012345", resolvedAt: null },
    { ...base, id: "64a1f2b3c4d5e6f789012346", resolvedAt: new Date("2026-06-01T00:00:00Z") }
  ]);
  assert.match(embed.title, /Rapoarte recente/);
  assert.match(embed.description, /64a1f2b3c4d5e6f789012345/);
  assert.match(embed.description, /deschis/);
  assert.match(embed.description, /rezolvat/);
  assert.match(embed.footer.text, /resolve/);
});

function makeDeps(overrides: Partial<Parameters<typeof mod.createReportInteractionHandler>[0]> = {}) {
  return {
    logger: () => undefined,
    enforceCooldown: async () => true,
    startCommandLog: () => () => undefined,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction: unknown, payload: unknown) => payload,
    recordFeedbackReport: async () => base,
    getRecentFeedbackReports: async () => [base],
    resolveFeedbackReport: async () => true,
    requireGuildAdmin: async () => true,
    adminAlert: async () => undefined,
    GuildAuditLogModel: {
      create: async (doc: GuildAuditLogRecord) => doc,
      find: () => { const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] }; return chain; }
    },
    MessageFlags: { Ephemeral: 64 },
    ...overrides
  };
}

function makeInteraction(subcommand: string, values: Record<string, string | number | null> = {}) {
  const replies: unknown[] = [];
  return {
    interaction: {
      commandName: "report",
      guild: { id: "g1" },
      user: { id: "admin1" },
      deferred: false,
      replied: false,
      isChatInputCommand: () => true,
      reply: async (payload: unknown) => { replies.push(payload); return payload; },
      followUp: async (payload: unknown) => { replies.push(payload); return payload; },
      options: {
        getSubcommand: () => subcommand,
        getString: (name: string) => typeof values[name] === "string" ? String(values[name]) : null,
        getInteger: (name: string) => typeof values[name] === "number" ? Number(values[name]) : null
      }
    },
    replies
  };
}

test("/report list cere admin si afiseaza rapoartele recente", async () => {
  let adminChecked = false;
  let capturedLimit = 0;
  const edits: unknown[] = [];
  const handler = mod.createReportInteractionHandler(makeDeps({
    requireGuildAdmin: async () => { adminChecked = true; return true; },
    getRecentFeedbackReports: async (_guildId, limit) => {
      capturedLimit = limit;
      return [{ ...base, id: "64a1f2b3c4d5e6f789012345" }];
    },
    safeEdit: async (_interaction, payload) => { edits.push(payload); return payload; }
  }));
  const { interaction } = makeInteraction("list", { numar: 7 });

  await handler.handleReportInteraction(interaction);

  assert.equal(adminChecked, true);
  assert.equal(capturedLimit, 7);
  assert.match(JSON.stringify(edits[0]), /64a1f2b3c4d5e6f789012345/);
});

test("/report resolve cere admin si marcheaza raportul ca rezolvat", async () => {
  let capturedId = "";
  const edits: unknown[] = [];
  const handler = mod.createReportInteractionHandler(makeDeps({
    resolveFeedbackReport: async (_guildId, reportId) => {
      capturedId = reportId;
      return true;
    },
    safeEdit: async (_interaction, payload) => { edits.push(payload); return payload; }
  }));
  const { interaction } = makeInteraction("resolve", { id: "64a1f2b3c4d5e6f789012345" });

  await handler.handleReportInteraction(interaction);

  assert.equal(capturedId, "64a1f2b3c4d5e6f789012345");
  assert.match(String(edits[0]), /marcat ca rezolvat/);
});

test("/report list scrie in /bot-log (audit central pentru subcomanda admin sub comanda publica) (R[P2] #3)", async () => {
  const audits: Array<{ command?: string; result?: string }> = [];
  const handler = mod.createReportInteractionHandler(makeDeps({
    requireGuildAdmin: async () => true,
    GuildAuditLogModel: {
      create: async (doc: GuildAuditLogRecord) => {
        audits.push({ command: String(doc.command || ""), result: String(doc.result || "") });
        return doc;
      },
      find: () => { const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] }; return chain; }
    }
  }));
  const { interaction } = makeInteraction("list", { numar: 5 });
  await handler.handleReportInteraction(interaction);
  assert.deepEqual(audits.map(a => a.command), ["/report list"], "subcomanda admin /report list apare acum in /bot-log, ca /set sau /backup");
  assert.equal(audits[0].result, "Access granted.");
});

test("/report list auditeaza si REFUZUL de acces, nu doar succesul (R[Medium] #3)", async () => {
  const audits: Array<{ command?: string; result?: string }> = [];
  const edits: unknown[] = [];
  const handler = mod.createReportInteractionHandler(makeDeps({
    requireGuildAdmin: async () => false,
    safeEdit: async (_interaction, payload) => { edits.push(payload); return payload; },
    GuildAuditLogModel: {
      create: async (doc: GuildAuditLogRecord) => {
        audits.push({ command: String(doc.command || ""), result: String(doc.result || "") });
        return doc;
      },
      find: () => { const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] }; return chain; }
    }
  }));
  const { interaction } = makeInteraction("list", { numar: 5 });
  await handler.handleReportInteraction(interaction);
  assert.deepEqual(audits.map(a => a.command), ["/report list"], "refuzul de acces e scris in /bot-log");
  assert.equal(audits[0].result, "Access denied.");
});
