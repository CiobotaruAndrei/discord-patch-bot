import test from "node:test";
import assert from "node:assert/strict";

import { createGuildSliceCopyJournal } from "../../features/admin-records/guildSliceCopyJournal.js";
import { createSecurityStore } from "../../features/command-security/securityStore.js";
import { createOperationJournalRuntime } from "../../features/admin-records/operationJournalRuntime.js";
import { fakeJournalModel } from "./operationJournalTestKit.js";
import type { SliceUpdate } from "../../shared/guildDomainSliceStore.js";

function auditQuery(): { sort: () => ReturnType<typeof auditQuery>; skip: () => ReturnType<typeof auditQuery>; limit: () => ReturnType<typeof auditQuery>; lean: () => Promise<[]> } {
  const query = {
    sort: () => query,
    skip: () => query,
    limit: () => query,
    lean: async () => [] as []
  };
  return query;
}

interface DedicatedWrite {
  filter: Record<string, unknown>;
  update: SliceUpdate;
}

function dedicatedModel(writes: DedicatedWrite[], failTimes = 0) {
  let remaining = failTimes;
  return {
    async updateOne(filter: Record<string, unknown>, update: SliceUpdate) {
      if (remaining > 0) {
        remaining -= 1;
        throw new Error("copia dedicata a picat");
      }
      writes.push({ filter, update });
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };
}

test("copia feliei trece prin jurnal si ajunge in colectia dedicata", async () => {
  const writes: DedicatedWrite[] = [];
  const journal = fakeJournalModel();
  const copy = createGuildSliceCopyJournal({
    OperationJournalModel: journal,
    domain: "security",
    dedicatedModel: dedicatedModel(writes),
    logger: () => undefined
  });

  await copy("g1", { $set: { threatProtectionEnabled: true } });

  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].filter, { _id: "g1" });
  assert.deepEqual(writes[0].update, { $set: { threatProtectionEnabled: true } });
  const entries = [...journal.docs.values()];
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, "done");
  assert.equal(entries[0].kind, "guild-slice-copy");
});

test("o copie care pica lasa o intrare nefinalizata in jurnal", async () => {
  const journal = fakeJournalModel();
  const copy = createGuildSliceCopyJournal({
    OperationJournalModel: journal,
    domain: "security",
    dedicatedModel: dedicatedModel([], 1),
    logger: () => undefined
  });

  await assert.rejects(copy("g2", { $set: { purgeAmount: 30 } }));

  const entry = [...journal.docs.values()][0];
  assert.notEqual(entry.status, "done");
  assert.equal(entry.kind, "guild-slice-copy");
});

test("recuperarea reia copia ramasa in urma dupa o cadere", async () => {
  const journal = fakeJournalModel();
  const failing = createGuildSliceCopyJournal({
    OperationJournalModel: journal,
    domain: "security",
    dedicatedModel: dedicatedModel([], 1),
    logger: () => undefined
  });
  await assert.rejects(failing("g3", { $set: { threatProtectionEnabled: true } }));

  const writes: DedicatedWrite[] = [];
  const recovery = createOperationJournalRuntime({
    OperationJournalModel: journal,
    GuildModel: { updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }) },
    GuildAuditLogModel: { create: async () => undefined, find: () => auditQuery() },
    guildSliceModels: { security: dedicatedModel(writes) },
    logger: () => undefined
  });

  const result = await recovery.recoverPending({ olderThanMs: 0, limit: 10 });

  assert.equal(result.recovered, 1);
  assert.deepEqual(writes.map(write => write.filter), [{ _id: "g3" }]);
  assert.deepEqual(writes[0].update, { $set: { threatProtectionEnabled: true } });
});

test("un pipeline de agregare ramane copie jurnalizata, scrisa dupa documentul canonic", async () => {
  const order: string[] = [];
  const journal = fakeJournalModel();
  const writes: DedicatedWrite[] = [];
  const copy = createGuildSliceCopyJournal({
    OperationJournalModel: journal,
    domain: "security",
    dedicatedModel: {
      async updateOne(filter: Record<string, unknown>, update: SliceUpdate) {
        order.push("copie");
        writes.push({ filter, update });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    logger: () => undefined
  });
  const store = createSecurityStore(
    {
      async updateOne() {
        order.push("canonic");
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    { updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }) },
    undefined,
    undefined,
    copy
  );

  await store.updateOne({ _id: "g4" }, [{ $set: { warningChannelId: "canal" } }]);

  assert.deepEqual(
    order,
    ["canonic", "copie"],
    "un pipeline nu se poate imparti pe campuri, deci ramane scriere dubla si pastreaza ordinea canonic-apoi-copie"
  );
  assert.deepEqual(writes[0].update, [{ $set: { warningChannelId: "canal" } }]);
});

test("o scriere care nu atinge felia nu ajunge in jurnal", async () => {
  const journal = fakeJournalModel();
  const copy = createGuildSliceCopyJournal({
    OperationJournalModel: journal,
    domain: "security",
    dedicatedModel: dedicatedModel([]),
    logger: () => undefined
  });
  const store = createSecurityStore(
    { updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }) },
    { updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }) },
    undefined,
    undefined,
    copy
  );

  await store.updateOne({ _id: "g5" }, { $set: { notificationChannelId: "canal" } });

  assert.equal(journal.docs.size, 0);
});
