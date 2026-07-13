import test from "node:test";
import assert from "node:assert/strict";
import { createSeenRepository } from "../features/notifications/seenRepository.js";

type MongoCall = { filter: unknown; update: unknown; opts?: unknown };
type SeenFilter = Record<string, unknown>;
type SeenUpdate = {
  $push?: Record<string, unknown>;
  $pull?: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $setOnInsert?: Record<string, unknown>;
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

function makeFakeDeps(opts?: { seenDiscountInserted?: boolean; seenHashes?: string[]; seenUpdateInserted?: boolean; guildSubscribed?: boolean }) {
  const calls: MongoCall[] = [];
  const existsCalls: unknown[] = [];
  let updateOneCallCount = 0;
  const retryAttempts: Array<number | undefined> = [];
  const seenDiscountUpserts: MongoCall[] = [];
  const seenDiscountDeletes: unknown[] = [];
  const seenDiscountBulk: Array<{ ops: unknown[]; opts?: unknown }> = [];
  const seenDiscountFinds: unknown[] = [];
  const seenUpdateUpserts: MongoCall[] = [];
  const seenUpdateDeletes: unknown[] = [];
  const seenUpdateBulk: Array<{ ops: unknown[]; opts?: unknown }> = [];
  const adminAlerts: Array<{ kind: string; title: string; body: unknown; guildId?: string }> = [];

  const GuildModel = {
    updateOne: async (filter: unknown, update: unknown, mongoOpts?: unknown) => {
      updateOneCallCount++;
      calls.push({ filter, update, opts: mongoOpts });
      return { matchedCount: 1, modifiedCount: 1 };
    },
    exists: async (filter: unknown) => {
      existsCalls.push(filter);
      return opts?.guildSubscribed === false ? null : { _id: "g1" };
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
    find: (filter: unknown, _projection?: unknown) => {
      seenDiscountFinds.push(filter);
      return {
        lean: async () => {
          const all = (opts?.seenHashes ?? []).map(dealHash => ({ dealHash }));
          const dealHashCond = (filter as { dealHash?: { $in?: string[] } }).dealHash;
          if (dealHashCond && Array.isArray(dealHashCond.$in)) {
            const wanted = new Set(dealHashCond.$in);
            return all.filter(doc => wanted.has(doc.dealHash));
          }
          return all;
        }
      };
    },
    bulkWrite: async (ops: unknown[], mongoOpts?: unknown) => {
      seenDiscountBulk.push({ ops, opts: mongoOpts });
      return { upsertedCount: ops.length };
    }
  };

  const GuildSeenUpdateModel = {
    updateOne: async (filter: unknown, update: unknown, mongoOpts?: unknown) => {
      seenUpdateUpserts.push({ filter, update, opts: mongoOpts });
      return { upsertedCount: opts?.seenUpdateInserted === false ? 0 : 1 };
    },
    deleteOne: async (filter: unknown) => {
      seenUpdateDeletes.push(filter);
      return { deletedCount: 1 };
    },
    bulkWrite: async (ops: unknown[], mongoOpts?: unknown) => {
      seenUpdateBulk.push({ ops, opts: mongoOpts });
      return { upsertedCount: ops.length };
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
    OP_UPDATE_OPTS: { strict: false },
    adminAlert: async (kind, title, body, guildId) => {
      adminAlerts.push({ kind, title, body, guildId });
    }
  });

  return { repo, calls, existsCalls, retryAttempts, seenDiscountUpserts, seenDiscountDeletes, seenDiscountFinds, seenDiscountBulk, seenUpdateUpserts, seenUpdateDeletes, seenUpdateBulk, adminAlerts, count: () => updateOneCallCount };
}

test("claimSeenUpdate: guard read (exists) pe documentul guild + upsert ca singura scriere in colectie", async () => {
  const { repo, calls, existsCalls, seenUpdateUpserts } = makeFakeDeps();

  const result = await repo.claimSeenUpdate("g1", "ch1", "cs2", "u-99");

  assert.equal(calls.length, 0, "claim-ul nu mai scrie pe documentul guild (fara stare partiala)");
  assert.equal(existsCalls.length, 1, "guard-ul este un read (exists), nu un write");
  const guard = existsCalls[0] as SeenFilter;
  assert.equal(guard._id, "g1");
  assert.equal(guard.subscribed, true);
  assert.equal(guard.notificationChannelId, "ch1");
  assert.deepEqual(guard.updatesInitializing, { $ne: true });

  assert.equal(seenUpdateUpserts.length, 1, "seen-claim merge in colectia dedicata (singura scriere)");
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
  const { repo, seenUpdateUpserts } = makeFakeDeps({ guildSubscribed: false });
  const result = await repo.claimSeenUpdate("g1", "ch1", "cs2", "u-99");
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

test("claimSeenDiscount: guard read (exists) pe documentul guild + upsert ca singura scriere in colectia dedicata", async () => {
  const { repo, calls, existsCalls, seenDiscountUpserts } = makeFakeDeps();

  const result = await repo.claimSeenDiscount("g1", "ch-d", "hash-abc");

  assert.equal(calls.length, 0, "claim-ul nu mai scrie pe documentul guild (fara stare partiala)");
  assert.equal(existsCalls.length, 1, "guard-ul este un read (exists), nu un write");
  const guard = existsCalls[0] as SeenFilter;
  assert.equal(guard._id, "g1");
  assert.equal(guard.discountsSubscribed, true);
  assert.equal(guard.discountChannelId, "ch-d");
  assert.deepEqual(guard.discountsInitializing, { $ne: true });

  assert.equal(seenDiscountUpserts.length, 1, "seen-claim merge in colectia dedicata (singura scriere)");
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

test("loadSeenDiscountHashes cu candidati margineste query-ul cu $in (nu mai citeste tot istoricul guild-ului)", async () => {
  const { repo, seenDiscountFinds } = makeFakeDeps({ seenHashes: ["h1", "h2", "h3"] });
  const hashes = await repo.loadSeenDiscountHashes("g1", ["h2", "h9", "h2", ""]);
  assert.deepEqual(hashes, ["h2"], "intoarce doar candidatii vazuti");
  const filter = seenDiscountFinds[0] as { guildId: string; dealHash?: { $in?: string[] } };
  assert.equal(filter.guildId, "g1");
  assert.deepEqual(filter.dealHash?.$in, ["h2", "h9"], "query marginit la candidatii dedupati si nevizi (folosind indexul unic guildId+dealHash)");
});

test("loadSeenDiscountHashes cu lista de candidati goala nu atinge colectia", async () => {
  const { repo, seenDiscountFinds } = makeFakeDeps({ seenHashes: ["h1"] });
  const hashes = await repo.loadSeenDiscountHashes("g1", []);
  assert.deepEqual(hashes, []);
  assert.equal(seenDiscountFinds.length, 0, "zero query-uri cand nu exista candidati de verificat");
});

test("loadSeenDiscountHashes fara candidati pastreaza comportamentul vechi (tot istoricul)", async () => {
  const { repo, seenDiscountFinds } = makeFakeDeps({ seenHashes: ["h1", "h2"] });
  const hashes = await repo.loadSeenDiscountHashes("g1");
  assert.deepEqual(hashes, ["h1", "h2"]);
  const filter = seenDiscountFinds[0] as { dealHash?: unknown };
  assert.equal(filter.dealHash, undefined, "fara conditie pe dealHash cand candidatii lipsesc");
});

test("seedSeenUpdates face bulk upsert pentru baseline-ul abonarii (skip intrari invalide)", async () => {
  const { repo, seenUpdateBulk } = makeFakeDeps();
  await repo.seedSeenUpdates("g1", [
    { gameKey: "cs2", updateId: "u-1" },
    { gameKey: "dota", updateId: "u-2" },
    { gameKey: "", updateId: "u-3" }
  ]);
  assert.equal(seenUpdateBulk.length, 1, "un singur bulkWrite");
  const ops = seenUpdateBulk[0].ops as Array<{ updateOne: { filter: SeenFilter; update: SeenUpdate; upsert: boolean } }>;
  assert.equal(ops.length, 2, "intrarea cu gameKey gol e sarita");
  assert.deepEqual(ops[0].updateOne.filter, { guildId: "g1", gameKey: "cs2", updateId: "u-1" });
  assert.equal(ops[0].updateOne.upsert, true);
  assert.ok((ops[0].updateOne.update.$setOnInsert as Record<string, unknown>).seenAt instanceof Date);
});

test("seedSeenUpdates fara intrari valide nu atinge colectia", async () => {
  const { repo, seenUpdateBulk } = makeFakeDeps();
  await repo.seedSeenUpdates("g1", []);
  assert.equal(seenUpdateBulk.length, 0);
});

test("seedSeenDiscounts face bulk upsert si deduplica hash-urile", async () => {
  const { repo, seenDiscountBulk } = makeFakeDeps();
  await repo.seedSeenDiscounts("g1", ["h1", "h2", "h1", ""]);
  assert.equal(seenDiscountBulk.length, 1, "un singur bulkWrite");
  const ops = seenDiscountBulk[0].ops as Array<{ updateOne: { filter: SeenFilter; upsert: boolean } }>;
  assert.equal(ops.length, 2, "hash duplicat si gol eliminate");
  assert.deepEqual(ops[0].updateOne.filter, { guildId: "g1", dealHash: "h1" });
  assert.equal(ops[0].updateOne.upsert, true);
});

test("seedSeenDiscounts fara hash-uri valide nu atinge colectia", async () => {
  const { repo, seenDiscountBulk } = makeFakeDeps();
  await repo.seedSeenDiscounts("g1", ["", ""]);
  assert.equal(seenDiscountBulk.length, 0);
});

test("disableUpdatesForChannelError writes the error metadata and clears subscription state", async () => {

  const { repo, calls, retryAttempts, adminAlerts } = makeFakeDeps();

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
  assert.deepEqual(adminAlerts.map(alert => ({ kind: alert.kind, guildId: alert.guildId })), [
    { kind: "discord:updates-channel-disabled", guildId: "g1" }
  ]);
});

test("disableDiscountsForChannelError mirrors disableUpdatesForChannelError on the discounts schema", async () => {
  const { repo, calls, adminAlerts } = makeFakeDeps();

  await repo.disableDiscountsForChannelError("g1", "ch-d", "Unknown Channel");

  assert.equal(calls.length, 1);
  const { update } = calls[0] as { update: SeenUpdate };
  const setDoc = update.$set as DisableUpdateSet;
  assert.equal(setDoc.discountsSubscribed, false);
  assert.equal(setDoc.discountChannelId, null);
  assert.equal(setDoc.discountsInitializing, false);
  assert.equal(setDoc.discountsLastError?.message, "Unknown Channel");
  assert.deepEqual(adminAlerts.map(alert => ({ kind: alert.kind, guildId: alert.guildId })), [
    { kind: "discord:discounts-channel-disabled", guildId: "g1" }
  ]);
});
