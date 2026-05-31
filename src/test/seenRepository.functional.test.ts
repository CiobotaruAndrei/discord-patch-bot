import test from "node:test";
import assert from "node:assert/strict";
import { createSeenRepository } from "../features/notifications/seenRepository";

type MongoCall = { filter: unknown; update: unknown; opts?: unknown };
type SeenFilter = Record<string, unknown>;
type SeenUpdate = {
  $push?: Record<string, unknown>;
  $pull?: Record<string, unknown>;
  $set?: Record<string, unknown>;
};
type DisableErrorState = { message?: string; channelId?: string; at?: Date };
type DisableUpdateSet = {
  subscribed?: boolean;
  notificationChannelId?: null;
  updatesInitializing?: boolean;
  updatesLastError?: DisableErrorState;
  discountsSubscribed?: boolean;
  discountChannelId?: null;
  discountsInitializing?: boolean;
  discountsLastError?: DisableErrorState;
};

function makeFakeDeps(opts?: { seenDiscountInserted?: boolean; seenHashes?: string[]; seenUpdateInserted?: boolean }) {
  const calls: MongoCall[] = [];
  let updateOneCallCount = 0;
  const retryAttempts: Array<number | undefined> = [];
  const seenDiscountUpserts: MongoCall[] = [];
  const seenDiscountDeletes: unknown[] = [];
  const seenUpdateUpserts: MongoCall[] = [];
  const seenUpdateDeletes: unknown[] = [];

  const GuildModel = {
    updateOne: async (filter: unknown, update: unknown, mongoOpts?: unknown) => {
      updateOneCallCount++;
      calls.push({ filter, update, opts: mongoOpts });
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };

  const GuildSeenDiscountModel = {
    updateOne: async (filter: unknown, update: unknown, mongoOpts?: unknown) => {
      seenDiscountUpserts.push({ filter, update, opts: mongoOpts });
      return { upsertedCount: opts?.seenDiscountInserted === false ? 0 : 1 };
    },
    deleteOne: async (filter: unknown) => {
      seenDiscountDeletes.push(filter);
      return { deletedCount: 1 };
    },
    find: (_filter: unknown, _projection?: unknown) => ({
      lean: async () => (opts?.seenHashes ?? []).map(dealHash => ({ dealHash }))
    })
  };

  const GuildSeenUpdateModel = {
    updateOne: async (filter: unknown, update: unknown, mongoOpts?: unknown) => {
      seenUpdateUpserts.push({ filter, update, opts: mongoOpts });
      return { upsertedCount: opts?.seenUpdateInserted === false ? 0 : 1 };
    },
    deleteOne: async (filter: unknown) => {
      seenUpdateDeletes.push(filter);
      return { deletedCount: 1 };
    }
  };

  const withMongoRetry = async <T>(fn: () => Promise<T>, options?: { label?: string; retries?: number }): Promise<T> => {
    retryAttempts.push(options?.retries);
    return fn();
  };

  const repo = createSeenRepository({
    GuildModel: GuildModel as Parameters<typeof createSeenRepository>[0]["GuildModel"],
    GuildSeenDiscountModel: GuildSeenDiscountModel as Parameters<typeof createSeenRepository>[0]["GuildSeenDiscountModel"],
    GuildSeenUpdateModel: GuildSeenUpdateModel as Parameters<typeof createSeenRepository>[0]["GuildSeenUpdateModel"],
    withMongoRetry,
    SEEN_PER_GAME_LIMIT: 20,
    DEALS_HISTORY_LIMIT: 300,
    OP_UPDATE_OPTS: { strict: false }
  });

  return { repo, calls, retryAttempts, seenDiscountUpserts, seenDiscountDeletes, seenUpdateUpserts, seenUpdateDeletes, count: () => updateOneCallCount };
}

test("claimSeenUpdate: guard pe documentul guild (pull pending + lastProcessedGameKey) + upsert atomic in colectie", async () => {
  const { repo, calls, seenUpdateUpserts } = makeFakeDeps();

  const result = await repo.claimSeenUpdate("g1", "ch1", "cs2", "u-99");

  assert.equal(calls.length, 1, "un singur write pe documentul guild (guard + pull pending)");
  const { filter, update } = calls[0] as { filter: SeenFilter; update: SeenUpdate };
  assert.equal(filter._id, "g1");
  assert.equal(filter.subscribed, true);
  assert.equal(filter.notificationChannelId, "ch1");
  assert.equal(filter["seen.cs2"], undefined, "nu mai filtram pe seen pe documentul guild");
  assert.equal(update.$push, undefined, "nu mai impingem in seen pe documentul guild");
  assert.deepEqual(update.$pull, { "pendingUpdates.cs2": { id: "u-99" } });
  assert.deepEqual(update.$set, { lastProcessedGameKey: "cs2" });

  assert.equal(seenUpdateUpserts.length, 1, "seen-claim merge in colectia dedicata");
  const upsert = seenUpdateUpserts[0] as { filter: SeenFilter; opts?: { upsert?: boolean } };
  assert.deepEqual(upsert.filter, { guildId: "g1", gameKey: "cs2", updateId: "u-99" });
  assert.equal(upsert.opts?.upsert, true);
  assert.equal(result.matchedCount, 1, "upsertedCount=1 -> claim nou");
});

test("claimSeenUpdate: update deja vazut (upsertedCount=0) intoarce matchedCount 0", async () => {
  const { repo } = makeFakeDeps({ seenUpdateInserted: false });
  const result = await repo.claimSeenUpdate("g1", "ch1", "cs2", "u-99");
  assert.equal(result.matchedCount, 0);
});

test("claimSeenUpdate: guard nepotrivit (guild nesubscris) NU face upsert in colectie", async () => {
  const { repo, seenUpdateUpserts } = makeFakeDeps();
  const GuildModelUnsub = {
    updateOne: async () => ({ matchedCount: 0, modifiedCount: 0 })
  };
  const repoUnsub = createSeenRepository({
    GuildModel: GuildModelUnsub as unknown as Parameters<typeof createSeenRepository>[0]["GuildModel"],
    GuildSeenDiscountModel: { updateOne: async () => ({ upsertedCount: 1 }), deleteOne: async () => ({ deletedCount: 1 }), find: () => ({ lean: async () => [] }) } as unknown as Parameters<typeof createSeenRepository>[0]["GuildSeenDiscountModel"],
    GuildSeenUpdateModel: { updateOne: async () => { seenUpdateUpserts.push({ filter: {}, update: {} }); return { upsertedCount: 1 }; }, deleteOne: async () => ({ deletedCount: 1 }) } as unknown as Parameters<typeof createSeenRepository>[0]["GuildSeenUpdateModel"],
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    SEEN_PER_GAME_LIMIT: 20, DEALS_HISTORY_LIMIT: 300, OP_UPDATE_OPTS: {}
  });
  const result = await repoUnsub.claimSeenUpdate("g1", "ch1", "cs2", "u-99");
  assert.equal(result.matchedCount, 0, "guard nepotrivit -> claim esuat");
  assert.equal(seenUpdateUpserts.length, 0, "nu se atinge colectia daca guard-ul nu trece");
});

test("rollbackSeenUpdate sterge intrarea din colectia dedicata", async () => {
  const { repo, calls, seenUpdateDeletes } = makeFakeDeps();

  await repo.rollbackSeenUpdate("g1", "cs2", "u-99");

  assert.equal(calls.length, 0, "rollback nu mai atinge documentul guild");
  assert.equal(seenUpdateDeletes.length, 1);
  assert.deepEqual(seenUpdateDeletes[0], { guildId: "g1", gameKey: "cs2", updateId: "u-99" });
});

test("claimSeenDiscount: guard pe documentul guild (pull pending) + upsert atomic in colectia dedicata", async () => {
  const { repo, calls, seenDiscountUpserts } = makeFakeDeps();

  const result = await repo.claimSeenDiscount("g1", "ch-d", "hash-abc");

  assert.equal(calls.length, 1, "un singur write pe documentul guild (guard + pull pending)");
  const { filter, update } = calls[0] as { filter: SeenFilter; update: SeenUpdate };
  assert.equal(filter._id, "g1");
  assert.equal(filter.discountsSubscribed, true);
  assert.equal(filter.discountChannelId, "ch-d");
  assert.equal(update.$push, undefined, "nu mai impingem in seenDiscounts pe documentul guild");
  assert.deepEqual(update.$pull, { pendingDiscounts: { hash: "hash-abc" } });

  assert.equal(seenDiscountUpserts.length, 1, "seen-claim merge in colectia dedicata");
  const upsert = seenDiscountUpserts[0] as { filter: SeenFilter; update: SeenUpdate; opts?: { upsert?: boolean } };
  assert.deepEqual(upsert.filter, { guildId: "g1", dealHash: "hash-abc" });
  assert.equal(upsert.opts?.upsert, true);
  assert.equal(result.matchedCount, 1, "upsertedCount=1 -> claim nou");
});

test("claimSeenDiscount: hash deja vazut (upsertedCount=0) intoarce matchedCount 0", async () => {
  const { repo } = makeFakeDeps({ seenDiscountInserted: false });
  const result = await repo.claimSeenDiscount("g1", "ch-d", "hash-abc");
  assert.equal(result.matchedCount, 0, "deja in colectie -> nu retrimite");
});

test("rollbackSeenDiscount sterge intrarea din colectia dedicata", async () => {
  const { repo, calls, seenDiscountDeletes } = makeFakeDeps();

  await repo.rollbackSeenDiscount("g1", "hash-abc");

  assert.equal(calls.length, 0, "rollback nu mai atinge documentul guild");
  assert.equal(seenDiscountDeletes.length, 1);
  assert.deepEqual(seenDiscountDeletes[0], { guildId: "g1", dealHash: "hash-abc" });
});

test("loadSeenDiscountHashes intoarce hash-urile vazute din colectie", async () => {
  const { repo } = makeFakeDeps({ seenHashes: ["h1", "h2", "h3"] });
  const hashes = await repo.loadSeenDiscountHashes("g1");
  assert.deepEqual(hashes, ["h1", "h2", "h3"]);
});

test("disableUpdatesForChannelError writes the error metadata and clears subscription state", async () => {

  const { repo, calls, retryAttempts } = makeFakeDeps();

  await repo.disableUpdatesForChannelError("g1", "ch1", "Missing Access");

  assert.equal(calls.length, 1);
  const { update } = calls[0] as { update: SeenUpdate };
  const setDoc = update.$set as DisableUpdateSet;
  assert.equal(setDoc.subscribed, false);
  assert.equal(setDoc.notificationChannelId, null);
  assert.equal(setDoc.updatesInitializing, false);
  assert.equal(setDoc.updatesLastError?.message, "Missing Access");
  assert.equal(setDoc.updatesLastError?.channelId, "ch1");
  assert.ok(setDoc.updatesLastError?.at instanceof Date);
  assert.equal(retryAttempts.length, 0, "disable path does NOT need withMongoRetry");
});

test("disableDiscountsForChannelError mirrors disableUpdatesForChannelError on the discounts schema", async () => {
  const { repo, calls } = makeFakeDeps();

  await repo.disableDiscountsForChannelError("g1", "ch-d", "Unknown Channel");

  assert.equal(calls.length, 1);
  const { update } = calls[0] as { update: SeenUpdate };
  const setDoc = update.$set as DisableUpdateSet;
  assert.equal(setDoc.discountsSubscribed, false);
  assert.equal(setDoc.discountChannelId, null);
  assert.equal(setDoc.discountsInitializing, false);
  assert.equal(setDoc.discountsLastError?.message, "Unknown Channel");
});
