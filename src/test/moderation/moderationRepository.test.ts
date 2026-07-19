import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_WARN_HISTORY,
  addWarning,
  cleanupExpiredModeration,
  pullStaleTimeouts,
  reconcileTimeoutRecords,
  removeWarningById,
  removeWarning,
  saveMute,
  saveTimeout
} from "../../features/moderation/moderationRepository.js";

test("addWarning plafoneaza atomic istoricul de warn-uri prin $slice, ca documentul guild-ului sa nu creasca nelimitat (audit 154 #6)", async () => {
  let captured: unknown = null;
  const model = {
    findOne: async () => null,
    updateOne: async () => ({ modifiedCount: 0 }),
    findOneAndUpdate: async (_filter: Record<string, unknown>, update: unknown) => {
      captured = update;
      return { moderationWarnings: [{ warningId: "w", userId: "user-1", username: "u", moderatorId: "m", warnedAt: new Date() }], moderationWarnBanLimit: 0 };
    }
  };
  await addWarning(model, "guild-1", { warningId: "w", userId: "user-1", username: "u", moderatorId: "m", warnedAt: new Date() });
  const json = JSON.stringify(captured);
  assert.match(json, /"\$slice"/, "adaugarea foloseste $slice pentru a plafona array-ul");
  assert.match(json, new RegExp(`-${MAX_WARN_HISTORY}`), "pastreaza ultimele MAX_WARN_HISTORY warn-uri (self-healing si pentru array-urile deja mari)");
  assert.match(json, /"\$concatArrays"/, "noul warn e adaugat inainte de plafonare");
});

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

test("reconcileTimeoutRecords: marcheaza drept stale timeout-urile pe care Discord nu le mai are active (audit, #15)", () => {
  const now = Date.parse("2026-07-18T12:00:00.000Z");
  const base = { username: "u", moderatorId: "m", appliedAt: new Date(now - 10_000) };
  const records = [
    { ...base, userId: "still-timed-out", expiresAt: new Date(now + 60_000) },
    { ...base, userId: "cleared-in-discord", expiresAt: new Date(now + 60_000) },
    { ...base, userId: "left-guild", expiresAt: new Date(now + 60_000) },
    { ...base, userId: "already-expired-in-bot", expiresAt: new Date(now - 60_000) }
  ];
  const members = [
    { userId: "still-timed-out", communicationDisabledUntil: new Date(now + 60_000) },
    { userId: "cleared-in-discord", communicationDisabledUntil: null }
  ];

  const { staleUserIds } = reconcileTimeoutRecords(records, members, now);

  assert.ok(staleUserIds.includes("cleared-in-discord"), "timeout eliminat manual in Discord => stale");
  assert.ok(staleUserIds.includes("left-guild"), "membru plecat (fara stare) => stale");
  assert.ok(!staleUserIds.includes("still-timed-out"), "timeout inca activ in Discord NU e stale");
  assert.ok(!staleUserIds.includes("already-expired-in-bot"), "recordul deja expirat in bot nu e considerat activ, deci nu-l reconciliem aici");
});

test("pullStaleTimeouts: sterge doar userId-urile date, deduplicate, si nu scrie pentru lista goala (audit, #15)", async () => {
  const calls: UpdateCall[] = [];
  const model = {
    findOne: async () => null,
    findOneAndUpdate: async () => null,
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown> | readonly Record<string, unknown>[], options?: Record<string, unknown>) => {
      calls.push({ filter, update, options });
      return { modifiedCount: 1 };
    }
  };

  const removed = await pullStaleTimeouts(model, "guild-1", ["a", "a", "b", ""]);

  assert.equal(removed, 2, "userId-urile sunt deduplicate si golurile ignorate");
  assert.equal(calls.length, 1);
  assert.match(JSON.stringify(calls[0].update), /moderationTimeouts/);
  assert.match(JSON.stringify(calls[0].update), /"\$in":\["a","b"\]/);

  const noop = await pullStaleTimeouts(model, "guild-1", []);
  assert.equal(noop, 0, "lista goala nu produce scriere");
  assert.equal(calls.length, 1, "niciun updateOne suplimentar");
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
