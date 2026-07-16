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
