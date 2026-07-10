import test from "node:test";
import assert from "node:assert/strict";
import type { GuildAuditLogRecord } from "../features/admin-records/auditLogRepository";

import type { GuildSettings, SuggestedCommandEntry } from "../types";
import {
  deleteSuggestedCommand,
  listSuggestedCommands,
  saveSuggestedCommand
} from "../features/admin-records/suggestedCommandsRepository";

function suggestedCommandModel(existing: SuggestedCommandEntry[], deleteMatchedCount = 1) {
  const calls: Array<{ update: unknown; options?: unknown }> = [];
  const pulls: Array<Record<string, unknown>> = [];
  const filters: Array<Record<string, unknown>> = [];
  return {
    calls,
    pulls,
    filters,
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>, _options?: Record<string, unknown>) => {
      filters.push(filter);
      pulls.push(update);
      return { matchedCount: deleteMatchedCount, modifiedCount: deleteMatchedCount };
    },
    findOneAndUpdate: async (_filter: Record<string, unknown>, update: unknown, options?: Record<string, unknown>): Promise<{ suggestedCommands?: SuggestedCommandEntry[] } | null> => {
      calls.push({ update, options });
      return { suggestedCommands: existing };
    }
  };
}

test("saveSuggestedCommand salveaza atomic (findOneAndUpdate + pipeline) si raporteaza added pentru un nume nou", async () => {
  const model = suggestedCommandModel([]);
  const result = await saveSuggestedCommand(model, "guild-1", { commandName: "calendar", description: "x", createdBy: "u1" });
  assert.equal(result.added, true);
  assert.equal(model.calls.length, 1, "o singura operatie atomica, nu $push separat");
  assert.ok(Array.isArray(model.calls[0].update), "update-ul e un aggregation pipeline (dedupe)");
  assert.deepEqual(model.calls[0].options, { upsert: true });
});

test("saveSuggestedCommand nu dubleaza un nume deja propus (idempotent)", async () => {
  const model = suggestedCommandModel([{ commandName: "calendar", description: "x", createdBy: "u1", createdAt: new Date() }]);
  const result = await saveSuggestedCommand(model, "guild-1", { commandName: "calendar", description: "alta", createdBy: "u2" });
  assert.equal(result.added, false, "numele deja prezent => added=false (nu se dubleaza)");
});

test("listSuggestedCommands sorteaza descrescator si limiteaza; deleteSuggestedCommand normalizeaza numele si face $pull", async () => {
  const settings: GuildSettings = {
    _id: "guild-1",
    suggestedCommands: [
      { commandName: "old", description: "old", createdBy: "u1", createdAt: "2024-01-01T00:00:00.000Z" },
      { commandName: "new", description: "new", createdBy: "u2", createdAt: "2025-01-01T00:00:00.000Z" }
    ]
  };
  assert.deepEqual(listSuggestedCommands(settings, 1).map(entry => entry.commandName), ["new"]);

  const model = suggestedCommandModel([]);
  const auditDocs: GuildAuditLogRecord[] = [];
  const auditModel = {
    create: async (doc: GuildAuditLogRecord) => { auditDocs.push(doc); return doc; },
    find: () => { const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] }; return chain; }
  };
  const removed = await deleteSuggestedCommand(model, auditModel, "guild-1", "  /Calendar  ", { userId: "admin-1", action: "suggest_command_delete", details: "calendar" });
  assert.equal(removed, true);
  assert.deepEqual(model.filters[0], { _id: "guild-1", "suggestedCommands.commandName": "calendar" }, "filtrul cere existenta sugestiei, ca auditul sa nu se scrie pentru un delete inexistent");
  assert.deepEqual(model.pulls[0].$pull, { suggestedCommands: { commandName: "calendar" } }, "numele e normalizat (fara slash, lowercase) inainte de $pull");
  assert.equal(model.pulls[0].$push, undefined, "auditul nu mai e $push pe documentul guild");
  assert.equal(auditDocs[0].action, "suggest_command_delete", "auditul server-log e un document in colectia guildAuditLogs");
  assert.equal(auditDocs[0].userId, "admin-1");
});

test("deleteSuggestedCommand: sugestia inexistenta => false, iar auditul nu se scrie (matchedCount 0)", async () => {
  const model = suggestedCommandModel([], 0);
  const auditDocs: GuildAuditLogRecord[] = [];
  const auditModel = {
    create: async (doc: GuildAuditLogRecord) => { auditDocs.push(doc); return doc; },
    find: () => { const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] }; return chain; }
  };
  const removed = await deleteSuggestedCommand(model, auditModel, "guild-1", "inexistenta", { userId: "admin-1", action: "suggest_command_delete", details: "inexistenta" });
  assert.equal(removed, false);
  assert.equal(model.pulls.length, 1, "o singura incercare de scriere, refuzata de filtrul de existenta");
  assert.equal(auditDocs.length, 0, "fara audit pentru un delete care nu a sters nimic");
});
