import test from "node:test";
import assert from "node:assert/strict";
import { createSeenRepository } from "../features/notifications/seenRepository";

type MongoCall = { filter: unknown; update: unknown; opts?: unknown };

function makeFakeDeps(opts?: { retriesRequested?: number[] }) {
  const calls: MongoCall[] = [];
  let updateOneCallCount = 0;
  const retryAttempts: Array<number | undefined> = [];

  const GuildModel = {
    updateOne: async (filter: unknown, update: unknown, mongoOpts?: unknown) => {
      updateOneCallCount++;
      calls.push({ filter, update, opts: mongoOpts });
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };

  const withMongoRetry = async <T>(fn: () => Promise<T>, options?: { label?: string; retries?: number }): Promise<T> => {
    retryAttempts.push(options?.retries);
    return fn();
  };

  const repo = createSeenRepository({
    GuildModel: GuildModel as any,
    withMongoRetry,
    SEEN_PER_GAME_LIMIT: 20,
    DEALS_HISTORY_LIMIT: 300,
    OP_UPDATE_OPTS: { strict: false }
  });

  return { repo, calls, retryAttempts, count: () => updateOneCallCount };
}

test("claimSeenUpdate runs under withMongoRetry with the correct atomic filter+update", async () => {
  const { repo, calls, retryAttempts } = makeFakeDeps();

  await repo.claimSeenUpdate("g1", "ch1", "cs2", "u-99");

  assert.equal(calls.length, 1);
  const { filter, update } = calls[0] as { filter: Record<string, any>; update: Record<string, any> };

  assert.equal(filter._id, "g1");
  assert.equal(filter.subscribed, true);
  assert.equal(filter.notificationChannelId, "ch1");
  assert.deepEqual(filter["seen.cs2"], { $ne: "u-99" });
  assert.deepEqual(update.$push, { "seen.cs2": { $each: ["u-99"], $slice: -20 } });
  assert.deepEqual(update.$pull, { "pendingUpdates.cs2": { id: "u-99" } });
  assert.deepEqual(update.$set, { lastProcessedGameKey: "cs2" });

  assert.equal(retryAttempts.length, 1);
});

test("rollbackSeenUpdate runs under withMongoRetry — critical to recover lost notifications on transient blips", async () => {
  const { repo, calls, retryAttempts } = makeFakeDeps();

  await repo.rollbackSeenUpdate("g1", "cs2", "u-99");

  assert.equal(calls.length, 1);
  const { filter, update } = calls[0] as { filter: Record<string, any>; update: Record<string, any> };
  assert.equal(filter._id, "g1");
  assert.deepEqual(update.$pull, { "seen.cs2": "u-99" });
  assert.equal(retryAttempts.length, 1, "rollback MUST be wrapped in withMongoRetry");
});

test("claimSeenDiscount runs under withMongoRetry with the correct atomic filter+update", async () => {
  const { repo, calls, retryAttempts } = makeFakeDeps();

  await repo.claimSeenDiscount("g1", "ch-d", "hash-abc");

  assert.equal(calls.length, 1);
  const { filter, update } = calls[0] as { filter: Record<string, any>; update: Record<string, any> };
  assert.equal(filter._id, "g1");
  assert.equal(filter.discountsSubscribed, true);
  assert.equal(filter.discountChannelId, "ch-d");
  assert.deepEqual(filter.seenDiscounts, { $ne: "hash-abc" });
  assert.deepEqual(update.$push, { seenDiscounts: { $each: ["hash-abc"], $slice: -300 } });
  assert.deepEqual(update.$pull, { pendingDiscounts: { hash: "hash-abc" } });
  assert.equal(retryAttempts.length, 1);
});

test("rollbackSeenDiscount runs under withMongoRetry — symmetric guard against lost notifications", async () => {
  const { repo, calls, retryAttempts } = makeFakeDeps();

  await repo.rollbackSeenDiscount("g1", "hash-abc");

  assert.equal(calls.length, 1);
  const { filter, update } = calls[0] as { filter: Record<string, any>; update: Record<string, any> };
  assert.equal(filter._id, "g1");
  assert.deepEqual(update.$pull, { seenDiscounts: "hash-abc" });
  assert.equal(retryAttempts.length, 1);
});

test("disableUpdatesForChannelError writes the error metadata and clears subscription state", async () => {

  const { repo, calls, retryAttempts } = makeFakeDeps();

  await repo.disableUpdatesForChannelError("g1", "ch1", "Missing Access");

  assert.equal(calls.length, 1);
  const { update } = calls[0] as { update: Record<string, any> };
  assert.equal(update.$set.subscribed, false);
  assert.equal(update.$set.notificationChannelId, null);
  assert.equal(update.$set.updatesInitializing, false);
  assert.equal(update.$set.updatesLastError.message, "Missing Access");
  assert.equal(update.$set.updatesLastError.channelId, "ch1");
  assert.ok(update.$set.updatesLastError.at instanceof Date);
  assert.equal(retryAttempts.length, 0, "disable path does NOT need withMongoRetry");
});

test("disableDiscountsForChannelError mirrors disableUpdatesForChannelError on the discounts schema", async () => {
  const { repo, calls } = makeFakeDeps();

  await repo.disableDiscountsForChannelError("g1", "ch-d", "Unknown Channel");

  assert.equal(calls.length, 1);
  const { update } = calls[0] as { update: Record<string, any> };
  assert.equal(update.$set.discountsSubscribed, false);
  assert.equal(update.$set.discountChannelId, null);
  assert.equal(update.$set.discountsInitializing, false);
  assert.equal(update.$set.discountsLastError.message, "Unknown Channel");
});
