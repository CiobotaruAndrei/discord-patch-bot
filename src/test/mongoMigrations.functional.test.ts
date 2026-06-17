import test from "node:test";
import assert from "node:assert/strict";
import attachMigrations = require("../infra/mongo/migrations");

interface GuildDoc {
  _id: string;
  enabledStores?: string[];
  maxAbsolutePrice?: number;
  enabledGames?: string[];
  seenDiscounts?: string[];
  seen?: Record<string, string[]>;
}

type MigrationStateDoc = {
  _id: string;
  lastApplied?: number;
  lastAppliedAt?: Date;
};

interface UpdateManyCall {
  collection: string;
  filter: unknown;
  update: unknown;
}

interface FakeMigrationOverrides {
  acquireDbLock?: () => Promise<string | null>;
  initialMigrationState?: MigrationStateDoc | null;
}

type MigrationContext = Parameters<typeof attachMigrations>[0];
type MigrationCollection = ReturnType<MigrationContext["mongoose"]["connection"]["collection"]>;

function fakeCollection(impl: Partial<MigrationCollection>): MigrationCollection {
  return {
    async updateMany() { return {}; },
    async updateOne() { return {}; },
    async findOne() { return null; },
    async bulkWrite() { return {}; },
    async *find() {},
    ...impl
  };
}

function createFakeMigrationContext(overrides: FakeMigrationOverrides = {}) {
  const updateManyCalls: UpdateManyCall[] = [];
  const releaseCalls: Array<{ name: string; token: string }> = [];
  const guilds: GuildDoc[] = [{
    _id: "guild-1",
    seenDiscounts: Array.from({ length: 520 }, (_, index) => `deal-${index}`),
    seen: { cs2: ["u-1", "u-2"], dota: ["u-3"] }
  }];
  let migrationState: MigrationStateDoc | null = overrides.initialMigrationState ?? null;

  const guildCollection = {
    async updateMany(filter: unknown, update: unknown) {
      updateManyCalls.push({ collection: "guilds", filter, update });
      if (Array.isArray(update)) {
        for (const stage of update) {
          const setStage = (stage as { $set?: Record<string, unknown> }).$set;
          if (!setStage || !setStage.seenDiscounts) continue;
          const sliceOp = (setStage.seenDiscounts as { $slice?: unknown[] }).$slice;
          if (!Array.isArray(sliceOp)) continue;
          const sliceCount = sliceOp[1] as number;
          for (const guild of guilds) {
            if (Array.isArray(guild.seenDiscounts) && guild.seenDiscounts.length > 500) {
              guild.seenDiscounts = guild.seenDiscounts.slice(sliceCount);
            }
          }
        }
      }
      return { modifiedCount: 1 };
    },
    find(filter?: { seen?: unknown; seenDiscounts?: unknown }) {
      if (filter && "seen" in filter) {
        const matching = guilds.filter(guild => guild.seen && Object.keys(guild.seen).length > 0);
        return {
          async toArray() { return matching.map(guild => ({ _id: guild._id, seen: guild.seen })); },
          async *[Symbol.asyncIterator]() {
            for (const guild of matching) yield { _id: guild._id, seen: guild.seen };
          }
        };
      }
      const matching = guilds.filter(guild => Array.isArray(guild.seenDiscounts) && guild.seenDiscounts.length > 0);
      return {
        async toArray() {
          return matching.map(guild => ({ _id: guild._id, seenDiscounts: guild.seenDiscounts }));
        },
        async *[Symbol.asyncIterator]() {
          for (const guild of matching) yield { _id: guild._id, seenDiscounts: guild.seenDiscounts };
        }
      };
    },
    async updateOne(filter: { _id?: string }, update: { $set?: Partial<GuildDoc> }) {
      const doc = guilds.find(guild => guild._id === filter._id);
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { modifiedCount: doc ? 1 : 0 };
    }
  };

  const systemCollection = {
    async findOne(filter: { _id: string }) {
      return migrationState && migrationState._id === filter._id ? migrationState : null;
    },
    async updateOne(filter: { _id: string }, update: { $set?: Partial<MigrationStateDoc> }) {
      migrationState = { _id: filter._id, ...migrationState, ...update.$set };
      return { upsertedCount: 1 };
    }
  };

  const seenDiscountBulkOps: unknown[] = [];
  const guildSeenDiscountCollection = {
    async bulkWrite(ops: unknown[]) {
      seenDiscountBulkOps.push(...ops);
      return { upsertedCount: ops.length };
    }
  };
  const seenUpdateBulkOps: unknown[] = [];
  const guildSeenUpdateCollection = {
    async bulkWrite(ops: unknown[]) {
      seenUpdateBulkOps.push(...ops);
      return { upsertedCount: ops.length };
    }
  };

  const connection = {
    db: {},
    collection(name: string): MigrationCollection {
      if (name === "guilds") return fakeCollection(guildCollection);
      if (name === "system") return fakeCollection(systemCollection);
      if (name === "guildSeenDiscounts") return fakeCollection(guildSeenDiscountCollection);
      if (name === "guildSeenUpdates") return fakeCollection(guildSeenUpdateCollection);
      throw new Error(`Unexpected collection ${name}`);
    }
  };

  const context: MigrationContext = {
    mongoose: { connection },
    acquireDbLock: overrides.acquireDbLock || (async () => "migration-lock-token"),
    releaseDbLock: async (name: string, token: string) => {
      releaseCalls.push({ name, token });
    }
  };

  attachMigrations(context);
  const { runMigrations, ALL_MIGRATIONS } = context;
  if (!runMigrations || !ALL_MIGRATIONS) {
    throw new Error("attachMigrations trebuie sa ataseze runMigrations + ALL_MIGRATIONS");
  }
  const runtime = Object.assign(context, { runMigrations, ALL_MIGRATIONS });
  return { context: runtime, guilds, get migrationState() { return migrationState; }, updateManyCalls, releaseCalls, seenDiscountBulkOps, seenUpdateBulkOps };
}

test("Mongo migrations apply pending migrations and release the lock", async () => {
  const fixture = createFakeMigrationContext();
  const logs: Array<{ level: string; context: string; message: string }> = [];

  const result = await fixture.context.runMigrations((level: string, context: string, message: string) => {
    logs.push({ level, context, message });
  });

  assert.deepEqual(result.applied, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(result.skipped, 0);
  assert.equal(fixture.updateManyCalls.length, 5, "m1-m4 + m7 folosesc updateMany; m5 si m6 folosesc find + bulkWrite");
  const m4Call = fixture.updateManyCalls[3];
  assert.deepEqual(m4Call.filter, { "seenDiscounts.500": { $exists: true } });
  assert.ok(Array.isArray(m4Call.update), "m4 trebuie sa foloseasca aggregation pipeline (array)");
  assert.deepEqual(
    (m4Call.update as Array<{ $set: { seenDiscounts: { $slice: unknown[] } } }>)[0].$set.seenDiscounts.$slice,
    ["$seenDiscounts", -300]
  );
  assert.equal(fixture.guilds[0].seenDiscounts?.length, 300);
  assert.equal(fixture.guilds[0].seenDiscounts?.[0], "deal-220");
  assert.equal(fixture.seenDiscountBulkOps.length, 300, "m5 backfilleaza cele 300 hash-uri ramase in colectia dedicata");
  const firstBackfill = fixture.seenDiscountBulkOps[0] as { updateOne: { filter: { guildId: string; dealHash: string }; upsert: boolean } };
  assert.deepEqual(firstBackfill.updateOne.filter, { guildId: "guild-1", dealHash: "deal-220" });
  assert.equal(firstBackfill.updateOne.upsert, true);
  assert.equal(fixture.seenUpdateBulkOps.length, 3, "m6 backfilleaza cele 3 perechi (gameKey, updateId) din map-ul seen");
  const firstSeenUpdate = fixture.seenUpdateBulkOps[0] as { updateOne: { filter: { guildId: string; gameKey: string; updateId: string }; upsert: boolean } };
  assert.deepEqual(firstSeenUpdate.updateOne.filter, { guildId: "guild-1", gameKey: "cs2", updateId: "u-1" });
  assert.equal(firstSeenUpdate.updateOne.upsert, true);
  const m7Call = fixture.updateManyCalls[4];
  assert.deepEqual(m7Call.filter, { $or: [{ seen: { $exists: true } }, { seenDiscounts: { $exists: true } }] });
  assert.deepEqual(m7Call.update, { $unset: { seen: "", seenDiscounts: "" } });
  assert.equal(fixture.migrationState?.lastApplied, 7);
  assert.equal(fixture.releaseCalls.length, 1);
  assert.deepEqual(fixture.releaseCalls[0], { name: "db_migrations", token: "migration-lock-token" });
  assert.ok(logs.some(log => log.context === "MIGRATE" && log.message.includes("#7")));
});

test("alta instanta tine lock-ul dar schema e deja sincronizata -> asteapta, continua boot-ul fara throw", async () => {
  const fixture = createFakeMigrationContext({
    acquireDbLock: async () => null,
    initialMigrationState: { _id: "migrationState", lastApplied: 7 }
  });
  let slept = 0;

  const result = await fixture.context.runMigrations(() => null, {
    sleep: async () => { slept++; },
    waitTimeoutMs: 10_000,
    pollIntervalMs: 100
  });

  assert.deepEqual(result.applied, []);
  assert.equal(result.skipped, fixture.context.ALL_MIGRATIONS.length);
  assert.equal(result.waited, true, "marcheaza ca a asteptat sincronizarea altei instante");
  assert.equal(slept, 0, "schema deja la zi (lastApplied=7) -> intoarce la prima verificare, fara sa doarma");
  assert.equal(fixture.releaseCalls.length, 0, "nu a tinut niciun lock");
});

test("alta instanta tine lock-ul si nu termina in timeout -> fail-fast (throw)", async () => {
  const fixture = createFakeMigrationContext({
    acquireDbLock: async () => null,
    initialMigrationState: { _id: "migrationState", lastApplied: 3 }
  });
  let clock = 0;

  await assert.rejects(
    fixture.context.runMigrations(() => null, {
      now: () => clock,
      sleep: async (ms: number) => { clock += ms; },
      waitTimeoutMs: 1_000,
      pollIntervalMs: 100
    }),
    /Timeout.*migrarile.*lastApplied=3 < 7.*fail-fast/s,
    "schema ramane sub target (3 < 7) pana la timeout -> arunca pentru ca boot-ul sa se opreasca"
  );
  assert.equal(fixture.releaseCalls.length, 0);
});
