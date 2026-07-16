import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanupExpiredModeration,
  removeWarningById,
  removeWarning,
  saveMute,
  saveTimeout
} from "../../features/moderation/moderationRepository.js";

type UpdateCall = {
  filter: Record<string, unknown>;
  update: Record<string, unknown> | readonly Record<string, unknown>[];
  options?: Record<string, unknown>;
};

test("timeout si mute se scriu atomic si se exclud reciproc", async () => {
  const calls: UpdateCall[] = [];
  const model = {
    findOne: async () => null,
    findOneAndUpdate: async () => null,
    updateOne: async (
      filter: Record<string, unknown>,
      update: Record<string, unknown> | readonly Record<string, unknown>[],
      options?: Record<string, unknown>
    ) => {
      calls.push({ filter, update, options });
      return { modifiedCount: 1 };
    }
  };
  const record = {
    userId: "user-1",
    username: "user",
    moderatorId: "admin-1",
    appliedAt: new Date("2026-07-16T12:00:00.000Z"),
    expiresAt: new Date("2026-07-16T13:00:00.000Z")
  };

  await saveTimeout(model, "guild-1", record);
  await saveMute(model, "guild-1", record);

  assert.equal(calls.length, 2);
  assert.equal(Array.isArray(calls[0].update), true);
  assert.deepEqual(calls[0].options, { upsert: true });
  assert.match(JSON.stringify(calls[0].update), /moderationTimeouts/);
  assert.match(JSON.stringify(calls[0].update), /moderationMutes/);
  assert.match(JSON.stringify(calls[1].update), /moderationMutes/);
  assert.match(JSON.stringify(calls[1].update), /moderationTimeouts/);
});

test("remove-warn elimina un singur avertisment si raporteaza numarul ramas", async () => {
  const model = {
    findOne: async () => null,
    findOneAndUpdate: async () => ({
      moderationWarnings: [
        { userId: "user-1", username: "user", moderatorId: "admin", warnedAt: new Date() },
        { userId: "user-2", username: "other", moderatorId: "admin", warnedAt: new Date() }
      ]
    }),
    updateOne: async () => ({ modifiedCount: 1 })
  };

  const result = await removeWarning(model, "guild-1", "user-1");

  assert.deepEqual(result, { removed: true, remaining: 1 });
});

test("rollback-ul unui warn elimina exact avertismentul creat de operatia esuata", async () => {
  const calls: UpdateCall[] = [];
  const model = {
    findOne: async () => null,
    findOneAndUpdate: async (
      filter: Record<string, unknown>,
      update: Record<string, unknown> | readonly Record<string, unknown>[],
      options?: Record<string, unknown>
    ) => {
      calls.push({ filter, update, options });
      return { moderationWarnings: [] };
    },
    updateOne: async () => ({ modifiedCount: 1 })
  };

  const removed = await removeWarningById(model, "guild-1", "warning-2");

  assert.equal(removed, true);
  assert.deepEqual(calls[0].filter, { _id: "guild-1", "moderationWarnings.warningId": "warning-2" });
  assert.deepEqual(calls[0].update, { $pull: { moderationWarnings: { warningId: "warning-2" } } });
  assert.deepEqual(calls[0].options, { returnDocument: "after" });
});

test("cleanup-ul global sterge timeout-urile si mute-urile expirate", async () => {
  const calls: UpdateCall[] = [];
  const model = {
    findOne: async () => null,
    findOneAndUpdate: async () => null,
    updateOne: async () => ({ modifiedCount: 1 }),
    updateMany: async (
      filter: Record<string, unknown>,
      update: Record<string, unknown> | readonly Record<string, unknown>[]
    ) => {
      calls.push({ filter, update });
      return { modifiedCount: 2 };
    }
  };
  const now = new Date("2026-07-16T12:00:00.000Z");

  await cleanupExpiredModeration(model, now);

  assert.equal(calls.length, 1);
  assert.match(JSON.stringify(calls[0].filter), /moderationTimeouts/);
  assert.match(JSON.stringify(calls[0].filter), /moderationMutes/);
  assert.match(JSON.stringify(calls[0].update), /\$pull/);
});
