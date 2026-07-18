import test from "node:test";
import assert from "node:assert/strict";
import { createBotObservationAggregator } from "../../features/command-security/botObservationAggregator.js";
import { createBotObservationRepository } from "../../features/command-security/botObservationRepository.js";
import type { GuildAuditLogRecord } from "../../features/admin-records/auditLogRepository.js";

test("observation aggregator deduplicates audit ids and detects bursts per guild", () => {
  const aggregator = createBotObservationAggregator({ windowMs: 1000, burstThreshold: 2 });
  aggregator.record({ id: "1", guildId: "g1", kind: "threat", at: 100 });
  aggregator.record({ id: "1", guildId: "g1", kind: "threat", at: 100 });
  const snapshot = aggregator.record({ id: "2", guildId: "g1", kind: "new-account", at: 200 });
  assert.equal(snapshot.total, 2);
  assert.equal(snapshot.byKind.threat, 1);
  assert.equal(snapshot.burst, true);
  assert.equal(aggregator.snapshot("g1", 1201).total, 0);
});

test("observation repository persista idempotent si poate rehidrata evenimentele", async () => {
  const docs: GuildAuditLogRecord[] = [];
  const model = {
    create: async (doc: GuildAuditLogRecord) => { docs.push(doc); },
    updateOne: async (_filter: Record<string, unknown>, update: Record<string, unknown>) => {
      const document = (update.$setOnInsert ?? {}) as GuildAuditLogRecord;
      if (!docs.some(doc => doc.operationId === document.operationId)) docs.push(document);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    find: (_filter: Record<string, unknown>) => {
      const query = {
        sort: () => query,
        skip: () => query,
        limit: () => query,
        lean: async () => docs
      };
      return query;
    }
  };
  const repository = createBotObservationRepository(model);
  const event = { id: "obs-1", guildId: "g1", kind: "threat" as const, at: 100, details: "confirmed" };
  await repository.record(event);
  await repository.record(event);
  const restored = await repository.loadRecent("g1", 0);
  assert.equal(docs.length, 1);
  assert.deepEqual(restored, [event]);
});
