import test from "node:test";
import assert from "node:assert/strict";
import type { GuildAuditLogRecord } from "../features/admin-records/auditLogRepository";

import {
  MAX_SUGGESTED_COMMANDS,
  deleteSuggestedCommand,
  listSuggestedCommands,
  saveSuggestedCommand,
  type GuildSuggestedCommandRecord
} from "../features/admin-records/suggestedCommandsRepository";

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
    deleteMany: async (filter: Record<string, unknown>) => {
      const names = (filter.commandName as { $in: string[] }).$in;
      const before = docs.length;
      for (const name of names) {
        const index = docs.findIndex(doc => doc.guildId === filter.guildId && doc.commandName === name);
        if (index >= 0) docs.splice(index, 1);
      }
      return { deletedCount: before - docs.length };
    },
    find: (filter: Record<string, unknown>) => {
      let sorted = docs.filter(doc => doc.guildId === filter.guildId);
      let skipped = 0;
      let limited = Number.POSITIVE_INFINITY;
      const chain = {
        sort: (spec: Record<string, 1 | -1>) => {
          const direction = spec.createdAt === 1 ? 1 : -1;
          sorted = [...sorted].sort((a, b) => direction * (new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime()));
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

function makeAuditModel(auditDocs: GuildAuditLogRecord[]) {
  return {
    create: async (doc: GuildAuditLogRecord) => { auditDocs.push(doc); return doc; },
    find: () => { const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] }; return chain; }
  };
}

test("saveSuggestedCommand insereaza pe cheia naturala (guildId, commandName) si raporteaza added pentru un nume nou", async () => {
  const { model, docs } = makeSuggestedCommandModel();
  const result = await saveSuggestedCommand(model, "guild-1", { commandName: "calendar", description: "x", createdBy: "u1" });
  assert.equal(result.added, true);
  assert.equal(docs.length, 1, "sugestia e un document in colectia guildSuggestedCommands");
  assert.equal(docs[0].guildId, "guild-1");
  assert.equal(docs[0].commandName, "calendar");
  assert.equal(docs[0].description, "x");
});

test("saveSuggestedCommand nu dubleaza si nu rescrie un nume deja propus ($setOnInsert pastreaza intrarea originala)", async () => {
  const { model, docs } = makeSuggestedCommandModel([
    { guildId: "guild-1", commandName: "calendar", description: "x", createdBy: "u1", createdAt: new Date("2025-01-01T00:00:00.000Z") }
  ]);
  const result = await saveSuggestedCommand(model, "guild-1", { commandName: "calendar", description: "alta", createdBy: "u2" });
  assert.equal(result.added, false, "numele deja prezent => added=false (nu se dubleaza)");
  assert.equal(docs.length, 1);
  assert.equal(docs[0].description, "x", "descrierea originala nu e rescrisa de propunerea duplicata");
  assert.equal(docs[0].createdBy, "u1");
});

test("saveSuggestedCommand pastreaza cel mult 100 de sugestii per guild si evacueaza cele mai vechi (inlocuieste $slice)", async () => {
  const seeded = Array.from({ length: MAX_SUGGESTED_COMMANDS }, (_, index) => ({
    guildId: "guild-1",
    commandName: `sugestie-${index}`,
    description: "x",
    createdBy: "u1",
    createdAt: new Date(Date.UTC(2025, 0, 1, 0, index))
  }));
  const { model, docs } = makeSuggestedCommandModel([
    ...seeded,
    { guildId: "guild-2", commandName: "sugestie-0", description: "alt guild", createdBy: "u9", createdAt: new Date(Date.UTC(2020, 0, 1)) }
  ]);

  await saveSuggestedCommand(model, "guild-1", { commandName: "cea-noua", description: "y", createdBy: "u2" });

  const guild1 = docs.filter(doc => doc.guildId === "guild-1");
  assert.equal(guild1.length, MAX_SUGGESTED_COMMANDS, "capul de 100 per guild e pastrat");
  assert.equal(guild1.some(doc => doc.commandName === "sugestie-0"), false, "cea mai veche sugestie e evacuata la depasirea capului");
  assert.equal(guild1.some(doc => doc.commandName === "cea-noua"), true);
  assert.equal(docs.some(doc => doc.guildId === "guild-2"), true, "evictia e per guild, alt guild nu e atins");
});

test("listSuggestedCommands citeste din colectie sortat descrescator si limiteaza", async () => {
  const { model } = makeSuggestedCommandModel([
    { guildId: "guild-1", commandName: "old", description: "old", createdBy: "u1", createdAt: new Date("2024-01-01T00:00:00.000Z") },
    { guildId: "guild-1", commandName: "new", description: "new", createdBy: "u2", createdAt: new Date("2025-01-01T00:00:00.000Z") },
    { guildId: "guild-2", commandName: "alt", description: "alt", createdBy: "u3", createdAt: new Date("2026-01-01T00:00:00.000Z") }
  ]);
  assert.deepEqual((await listSuggestedCommands(model, "guild-1", 1)).map(entry => entry.commandName), ["new"]);
  assert.deepEqual((await listSuggestedCommands(model, "guild-1", 10)).map(entry => entry.commandName), ["new", "old"], "alt guild nu apare in listare");
});

test("deleteSuggestedCommand normalizeaza numele, sterge pe cheia naturala si scrie audit doar la delete real", async () => {
  const { model, docs } = makeSuggestedCommandModel([
    { guildId: "guild-1", commandName: "calendar", description: "x", createdBy: "u1", createdAt: new Date() }
  ]);
  const auditDocs: GuildAuditLogRecord[] = [];
  const removed = await deleteSuggestedCommand(model, makeAuditModel(auditDocs), "guild-1", "  /Calendar  ", { userId: "admin-1", action: "suggest_command_delete", details: "calendar" });
  assert.equal(removed, true);
  assert.equal(docs.length, 0, "numele e normalizat (fara slash, lowercase) inainte de stergere");
  assert.equal(auditDocs[0].action, "suggest_command_delete", "auditul server-log e un document in colectia guildAuditLogs");
  assert.equal(auditDocs[0].userId, "admin-1");
});

test("deleteSuggestedCommand: sugestia inexistenta => false, iar auditul nu se scrie (deletedCount 0)", async () => {
  const { model } = makeSuggestedCommandModel();
  const auditDocs: GuildAuditLogRecord[] = [];
  const removed = await deleteSuggestedCommand(model, makeAuditModel(auditDocs), "guild-1", "inexistenta", { userId: "admin-1", action: "suggest_command_delete", details: "inexistenta" });
  assert.equal(removed, false);
  assert.equal(auditDocs.length, 0, "fara audit pentru un delete care nu a sters nimic");
});
