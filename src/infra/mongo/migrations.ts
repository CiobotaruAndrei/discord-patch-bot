import type { Connection, Mongoose } from "mongoose";
import type { LockToken, LoggerFunction } from "../../types";
import { HASH_VERSION } from "../../shared/hashVersion";

interface Migration {
  id: number;
  name: string;
  up: (db: Connection) => Promise<void>;
}

interface MigrationStateDoc {
  _id: string;
  lastApplied?: number;
  lastAppliedAt?: Date;
}

interface RunMigrationsResult {
  applied: number[];
  skipped: number;
}

interface MigrationsContext {
  mongoose: Mongoose;
  acquireDbLock: (jobName: string, ttlMs: number) => Promise<LockToken | null>;
  releaseDbLock: (jobName: string, token: LockToken) => Promise<unknown>;
  runMigrations?: typeof runMigrations;
  ALL_MIGRATIONS?: Migration[];
}

const m1_addEnabledStores: Migration = {
  id: 1,
  name: "add-enabledStores-to-existing-guilds",
  async up(db) {
    const coll = db.collection("guilds");
    await coll.updateMany(
      { enabledStores: { $exists: false } },
      { $set: { enabledStores: [] } }
    );
  }
};

const m2_addMaxAbsolutePrice: Migration = {
  id: 2,
  name: "add-maxAbsolutePrice-to-existing-guilds",
  async up(db) {
    const coll = db.collection("guilds");
    await coll.updateMany(
      { maxAbsolutePrice: { $exists: false } },
      { $set: { maxAbsolutePrice: 0 } }
    );
  }
};

const m3_addEnabledGames: Migration = {
  id: 3,
  name: "add-enabledGames-to-existing-guilds",
  async up(db) {
    const coll = db.collection("guilds");
    await coll.updateMany(
      { enabledGames: { $exists: false } },
      { $set: { enabledGames: [] } }
    );
  }
};

const m4_trimSeenDiscounts: Migration = {
  id: 4,
  name: "trim-runaway-seenDiscounts",
  async up(db) {
    const coll = db.collection("guilds");
    await coll.updateMany(
      { "seenDiscounts.500": { $exists: true } },
      [{ $set: { seenDiscounts: { $slice: ["$seenDiscounts", -300] } } }]
    );
  }
};

const m5_backfillHashVersion: Migration = {
  id: 5,
  name: "backfill-seen-hash-version",
  async up(db) {
    const coll = db.collection("guilds");
    await coll.updateMany(
      { seenHashVersion: { $exists: false } },
      { $set: { seenHashVersion: HASH_VERSION } }
    );
    await coll.updateMany(
      { discountsHashVersion: { $exists: false } },
      { $set: { discountsHashVersion: HASH_VERSION } }
    );
  }
};

const ALL_MIGRATIONS: Migration[] = [
  m1_addEnabledStores,
  m2_addMaxAbsolutePrice,
  m3_addEnabledGames,
  m4_trimSeenDiscounts,
  m5_backfillHashVersion
];

const MIGRATION_LOCK_NAME = "db_migrations";
const MIGRATION_LOCK_TTL_MS = 5 * 60 * 1000;
let runtimeContext: Pick<MigrationsContext, "mongoose" | "acquireDbLock" | "releaseDbLock">;

async function runMigrations(logger: LoggerFunction): Promise<RunMigrationsResult> {
  const { mongoose, acquireDbLock, releaseDbLock } = runtimeContext;
  const db = mongoose.connection;
  if (!db.db) {
    logger("WARN", "MIGRATE", "Conexiunea Mongo nu e ready, sar peste migrari");
    return { applied: [], skipped: ALL_MIGRATIONS.length };
  }

  const lockToken = await acquireDbLock(MIGRATION_LOCK_NAME, MIGRATION_LOCK_TTL_MS);
  if (!lockToken) {
    logger("INFO", "MIGRATE", "Alta instanta ruleaza migrarile, sar peste acest boot");
    return { applied: [], skipped: ALL_MIGRATIONS.length };
  }

  try {
    const sysColl = db.collection<MigrationStateDoc>("system");
    const stateDoc = await sysColl.findOne({ _id: "migrationState" });
    const lastApplied = stateDoc && typeof stateDoc.lastApplied === "number"
      ? stateDoc.lastApplied
      : 0;

    const applied: number[] = [];
    let skipped = 0;

    for (const migration of ALL_MIGRATIONS) {
      if (migration.id <= lastApplied) {
        skipped++;
        continue;
      }

      const start = Date.now();
      try {
        logger("INFO", "MIGRATE", `Rulez migrarea #${migration.id}: ${migration.name}`);
        await migration.up(db);
        await sysColl.updateOne(
          { _id: "migrationState" },
          { $set: { lastApplied: migration.id, lastAppliedAt: new Date() } },
          { upsert: true }
        );
        applied.push(migration.id);
        logger("INFO", "MIGRATE", `Migrarea #${migration.id} finalizata in ${Date.now() - start}ms`);
      } catch (err) {
        logger("ERROR", "MIGRATE", `Migrarea #${migration.id} (${migration.name}) a esuat`, err);
        throw err;
      }
    }

    return { applied, skipped };
  } finally {
    await releaseDbLock(MIGRATION_LOCK_NAME, lockToken).catch(() => null);
  }
}

function attachMigrations(target: MigrationsContext): void {
  runtimeContext = {
    mongoose: target.mongoose,
    acquireDbLock: target.acquireDbLock,
    releaseDbLock: target.releaseDbLock
  };

  Object.assign(target, {
    runMigrations,
    ALL_MIGRATIONS
  });
}

export = attachMigrations;
