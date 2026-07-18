import test from "node:test";
import assert from "node:assert/strict";

import { createModerationLifecycleRuntime } from "../../features/moderation/moderationLifecycleRuntime.js";

test("lifecycle-ul curata sanctiunile expirate si datele membrului plecat", async () => {
  const calls: Array<{ kind: string; filter: Record<string, unknown>; update: Record<string, unknown> | readonly Record<string, unknown>[] }> = [];
  const runtime = createModerationLifecycleRuntime({
    findOne: async () => null,
    findOneAndUpdate: async () => null,
    updateOne: async (filter, update) => {
      calls.push({ kind: "one", filter, update });
      return { modifiedCount: 1 };
    },
    updateMany: async (filter, update) => {
      calls.push({ kind: "many", filter, update });
      return { modifiedCount: 1 };
    }
  });

  await runtime.cleanupExpired();
  await runtime.handleGuildMemberRemove({ id: "user-1", guild: { id: "guild-1" } });

  assert.equal(calls[0].kind, "many");
  assert.match(JSON.stringify(calls[0].update), /expiresAt/);
  assert.deepEqual(calls[1].filter, { _id: "guild-1" });
  assert.match(JSON.stringify(calls[1].update), /user-1/);
});

test("reconcilierea pastreaza sanctiunea Discord activa, elimina stale si rezolva dublura dupa cea mai recenta", async () => {
  const now = Date.now();
  const writes: Array<Record<string, unknown> | readonly Record<string, unknown>[]> = [];
  const timeoutOld = { userId: "both", username: "both", moderatorId: "m", appliedAt: new Date(now - 20_000), expiresAt: new Date(now + 60_000) };
  const muteNew = { ...timeoutOld, appliedAt: new Date(now - 10_000) };
  const runtime = createModerationLifecycleRuntime({
    findOne: async () => ({
      moderationTimeouts: [timeoutOld, { ...timeoutOld, userId: "stale" }, { ...timeoutOld, userId: "valid" }],
      moderationMutes: [muteNew]
    }),
    findOneAndUpdate: async () => null,
    updateOne: async (_filter, update) => { writes.push(update); return { modifiedCount: 1 }; }
  });
  const members = [
    { id: "both", communicationDisabledUntil: new Date(now + 60_000) },
    { id: "valid", communicationDisabledUntil: new Date(now + 60_000) },
    { id: "discord-only", communicationDisabledUntil: new Date(now + 60_000) }
  ];

  const removed = await runtime.reconcileClient({
    guilds: { cache: { values: () => [{ id: "guild-1", members: { fetch: async () => ({ values: () => members.values() }) } }].values() } }
  });

  assert.equal(removed, 2);
  const serialized = JSON.stringify(writes);
  assert.match(serialized, /stale/);
  assert.match(serialized, /both/);
  assert.doesNotMatch(serialized, /discord-only/);
});

test("reconcilierea continua cu celelalte servere daca fetch-ul unui guild esueaza", async () => {
  const warnings: object[] = [];
  const writes: Array<Record<string, unknown> | readonly Record<string, unknown>[]> = [];
  const runtime = createModerationLifecycleRuntime({
    findOne: async ({ _id }) => _id === "good" ? ({ moderationTimeouts: [{ userId: "stale", username: "u", moderatorId: "m", appliedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }] }) : null,
    findOneAndUpdate: async () => null,
    updateOne: async (_filter, update) => { writes.push(update); return { modifiedCount: 1 }; }
  }, (_level, _context, _message, meta) => { if (meta) warnings.push(meta); });
  const guilds = [
    { id: "bad", members: { fetch: async () => { throw new Error("missing members intent"); } } },
    { id: "good", members: { fetch: async () => ({ values: () => [][Symbol.iterator]() }) } }
  ];

  await runtime.reconcileClient({ guilds: { cache: { values: () => guilds.values() } } });

  assert.equal(warnings.length, 1);
  assert.match(JSON.stringify(writes), /stale/);
});
