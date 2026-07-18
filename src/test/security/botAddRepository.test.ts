import test from "node:test";
import assert from "node:assert/strict";

import {
  consumeBotAddPermission,
  createBotAddRequest,
  resolveBotAddRequest,
  stopBotAddProtectionAtomically
} from "../../features/moderation/botAddRepository.js";

type Call = {
  filter: Record<string, unknown>;
  update: Record<string, unknown> | readonly Record<string, unknown>[];
  options?: Record<string, unknown>;
};

function modelReturning(document: Record<string, unknown> | null) {
  const calls: Call[] = [];
  return {
    calls,
    model: {
      findOne: async () => document,
      findOneAndUpdate: async (
        filter: Record<string, unknown>,
        update: Record<string, unknown> | readonly Record<string, unknown>[],
        options?: Record<string, unknown>
      ) => {
        calls.push({ filter, update, options });
        return document;
      },
      updateOne: async (
        filter: Record<string, unknown>,
        update: Record<string, unknown> | readonly Record<string, unknown>[],
        options?: Record<string, unknown>
      ) => {
        calls.push({ filter, update, options });
        return { modifiedCount: 1 };
      }
    }
  };
}

test("solicitarea bot-add primeste expirare scurta si dedupe atomic pe bot plus requester", async () => {
  const now = new Date("2026-07-16T12:00:00.000Z");
  const request = {
    requestId: "request-1",
    botId: "bot-1",
    requesterId: "user-1",
    requestedAt: now
  };
  const document = {
    botAddPermissions: [{
      ...request,
      status: "pending",
      expiresAt: new Date(now.getTime() + 600_000)
    }]
  };
  const { model, calls } = modelReturning(document);

  const created = await createBotAddRequest(model, "guild-1", request, now);
  const write = calls[1];

  assert.equal(created.status, "pending");
  assert.equal(created.expiresAt?.getTime(), now.getTime() + 600_000);
  assert.deepEqual(
    ((write.filter.botAddPermissions as { $not: { $elemMatch: Record<string, unknown> } }).$not.$elemMatch),
    {
      botId: "bot-1",
      requesterId: "user-1",
      status: "pending",
      expiresAt: { $gt: now }
    }
  );
});

test("ownerul poate decide doar o solicitare pending neexpirata", async () => {
  const now = new Date("2026-07-16T12:00:00.000Z");
  const document = {
    botAddPermissions: [{
      requestId: "request-1",
      botId: "bot-1",
      requesterId: "user-1",
      requestedAt: now,
      ownerId: "owner-1",
      status: "approved",
      expiresAt: new Date(now.getTime() + 1_800_000)
    }]
  };
  const { model, calls } = modelReturning(document);

  const approved = await resolveBotAddRequest(model, "guild-1", "request-1", "approved", "owner-1", now);
  const write = calls[1];

  assert.equal(approved?.status, "approved");
  assert.deepEqual(write.filter, {
    _id: "guild-1",
    botAddPermissions: {
      $elemMatch: {
        requestId: "request-1",
        status: "pending",
        expiresAt: { $gt: now }
      }
    }
  });
});

test("aprobarea este consumata atomic doar pentru botul si requesterul exact", async () => {
  const now = new Date("2026-07-16T12:00:00.000Z");
  const document = {
    botAddPermissions: [{
      requestId: "request-1",
      botId: "bot-1",
      requesterId: "user-1",
      requestedAt: now,
      status: "used",
      usedAt: now,
      expiresAt: new Date(now.getTime() + 1_800_000)
    }]
  };
  const { model, calls } = modelReturning(document);

  const consumed = await consumeBotAddPermission(model, "guild-1", "bot-1", "user-1", now);
  const write = calls[1];

  assert.equal(consumed?.requestId, "request-1");
  assert.deepEqual(write.filter, {
    _id: "guild-1",
    botAddPermissions: {
      $elemMatch: {
        botId: "bot-1",
        requesterId: "user-1",
        status: "approved",
        expiresAt: { $gt: now }
      }
    }
  });
  assert.deepEqual(write.options?.arrayFilters, [{
    "entry.botId": "bot-1",
    "entry.requesterId": "user-1",
    "entry.status": "approved",
    "entry.expiresAt": { $gt: now }
  }]);
});

test("oprirea protectiei si anularea aprobarilor active folosesc un singur update atomic", async () => {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const { model, calls } = modelReturning(null);

  await stopBotAddProtectionAtomically(model, "guild-1", now);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].filter, { _id: "guild-1" });
  assert.ok(Array.isArray(calls[0].update));
  const pipeline = calls[0].update as readonly Record<string, unknown>[];
  const set = pipeline[0].$set as Record<string, unknown>;
  assert.equal(set.botAddProtectionEnabled, false);
  assert.deepEqual(set.botAddPermissions, {
    $map: {
      input: { $ifNull: ["$botAddPermissions", []] },
      as: "entry",
      in: {
        $cond: [
          {
            $and: [
              { $in: ["$$entry.status", ["pending", "approved"]] },
              { $gt: ["$$entry.expiresAt", now] }
            ]
          },
          {
            $mergeObjects: [
              "$$entry",
              {
                status: "cancelled",
                respondedAt: now,
                cancelledAt: now,
                cancellationReason: "protection-stopped"
              }
            ]
          },
          "$$entry"
        ]
      }
    }
  });
});
