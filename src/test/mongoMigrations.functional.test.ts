import test from "node:test";
import assert from "node:assert/strict";
import attachMigrations = require("../infra/mongo/migrations");

interface GuildDoc {
  _id: string;
  enabledStores?: string[];
  maxAbsolutePrice?: number;
  enabledGames?: string[];
  seenDiscounts?: string[];
}

interface MigrationStateDoc {
  _id: string;
  lastApplied?: number;
  lastAppliedAt?: Date;
}

interface UpdateManyCall {
  collection: string;
  filter: unknown;
  update: unknown;
}

interface FakeMigrationOverrides {
  acquireDbLock?: () => Promise<string | null>;
}

function createFakeMigrationContext(overrides: FakeMigrationOverrides = {}) {
  const updateManyCalls: UpdateManyCall[] = [];
  const releaseCalls: Array<{ name: string; token: string }> = [];
  const guilds: GuildDoc[] = [{
    _id: "guild-1",
    seenDiscounts: Array.from({ length: 520 }, (_, index) => `deal-${index}`)
  }];
  let migrationState: MigrationStateDoc | null = null;

  const guildCollection = {
    async updateMany(filter: unknown, update: unknown) {
      updateManyCalls.push({ collection: "guilds", filter, update });
      return { modifiedCount: 1 };
    },
    find() {
      return {
        async toArray() {
          return guilds
            .filter(guild => Array.isArray(guild.seenDiscounts) && guild.seenDiscounts.length > 500)
            .map(guild => ({ _id: guild._id, seenDiscounts: guild.seenDiscounts }));
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

  const connection = {
    db: {},
    collection(name: string) {
      if (name === "guilds") return guildCollection;
      if (name === "system") return systemCollection;
      throw new Error(`Unexpected collection ${name}`);
    }
  };

  const ctx: any = {
    mongoose: { connection },
    acquireDbLock: overrides.acquireDbLock || async () => "migration-lock-token",
    releaseDbLock: async (name: string, token: string) => {
      releaseCalls.push({ name, token });
    }
  };

  attachMigrations(ctx);
  return { ctx, guilds, get migrationState() { return migrationState; }, updateManyCalls, releaseCalls };
}

test("Mongo migrations apply pending migrations and release the lock", async () => {
  const fixture = createFakeMigrationContext();
  const logs: Array<{ level: string; context: string; message: string }> = [];

  const result = await fixture.ctx.runMigrations((level: string, context: string, message: string) => {
    logs.push({ level, context, message });
  });

  assert.deepEqual(result.applied, [1, 2, 3, 4]);
  assert.equal(result.skipped, 0);
  assert.equal(fixture.updateManyCalls.length, 3);
  assert.equal(fixture.guilds[0].seenDiscounts?.length, 300);
  assert.equal(fixture.guilds[0].seenDiscounts?.[0], "deal-220");
  assert.equal(fixture.migrationState?.lastApplied, 4);
  assert.equal(fixture.releaseCalls.length, 1);
  assert.deepEqual(fixture.releaseCalls[0], { name: "db_migrations", token: "migration-lock-token" });
  assert.ok(logs.some(log => log.context === "MIGRATE" && log.message.includes("#4")));
});

test("Mongo migrations skip safely when another instance holds the lock", async () => {
  const fixture = createFakeMigrationContext({ acquireDbLock: async () => null });

  const result = await fixture.ctx.runMigrations(() => null);

  assert.deepEqual(result.applied, []);
  assert.equal(result.skipped, fixture.ctx.ALL_MIGRATIONS.length);
  assert.equal(fixture.releaseCalls.length, 0);
  assert.equal(fixture.migrationState, null);
});
