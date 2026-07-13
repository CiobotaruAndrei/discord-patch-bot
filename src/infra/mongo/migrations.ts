import type { LockToken, LoggerFunction } from "../../types.js";
import type { Migration, MigrationCollectionLike, MigrationMongooseLike } from "./migrations/migrationTypes.js";
import { ALL_MIGRATIONS } from "./migrations/registry.js";

interface RunMigrationsResult {
  applied: number[];
  skipped: number;
  waited?: boolean;
}

interface RunMigrationsOptions {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
}

interface MigrationsContext {
  mongoose: MigrationMongooseLike;
  acquireDbLock: (jobName: string, ttlMs: number) => Promise<LockToken | null>;
  releaseDbLock: (jobName: string, token: LockToken) => Promise<unknown>;
  runMigrations?: typeof runMigrations;
  ALL_MIGRATIONS?: Migration[];
}

const MIGRATION_LOCK_NAME = "db_migrations";
const MIGRATION_LOCK_TTL_MS = 5 * 60 * 1000;
const MIGRATION_WAIT_TIMEOUT_MS = MIGRATION_LOCK_TTL_MS + 60 * 1000;
const MIGRATION_WAIT_POLL_MS = 2 * 1000;
let runtimeContext: Pick<MigrationsContext, "mongoose" | "acquireDbLock" | "releaseDbLock">;

const targetMigrationId = (): number => ALL_MIGRATIONS.reduce((max, migration) => Math.max(max, migration.id), 0);

async function readLastApplied(sysColl: MigrationCollectionLike): Promise<number> {
  const stateDoc = await sysColl.findOne({ _id: "migrationState" });
  return stateDoc && typeof stateDoc.lastApplied === "number" ? stateDoc.lastApplied : 0;
}

async function waitForOtherInstanceMigrations(
  sysColl: MigrationCollectionLike,
  logger: LoggerFunction,
  timing: Required<RunMigrationsOptions>
): Promise<RunMigrationsResult> {
  const target = targetMigrationId();
  logger("INFO", "MIGRATE", "Alta instanta ruleaza migrarile; astept sa se sincronizeze schema inainte de boot");
  const deadline = timing.now() + timing.waitTimeoutMs;
  for (;;) {
    const lastApplied = await readLastApplied(sysColl);
    if (lastApplied >= target) {
      logger("INFO", "MIGRATE", `Schema sincronizata de alta instanta (lastApplied=${lastApplied} >= ${target}), continui boot-ul`);
      return { applied: [], skipped: ALL_MIGRATIONS.length, waited: true };
    }
    if (timing.now() >= deadline) {
      throw new Error(`Timeout (${timing.waitTimeoutMs}ms) asteptand alta instanta sa termine migrarile (lastApplied=${lastApplied} < ${target}); schema poate fi inca neactualizata — opresc boot-ul (fail-fast; seteaza MIGRATIONS_CONTINUE_ON_ERROR=true ca sa pornesti oricum, pe propriul risc)`);
    }
    await timing.sleep(timing.pollIntervalMs);
  }
}

async function runMigrations(logger: LoggerFunction, options: RunMigrationsOptions = {}): Promise<RunMigrationsResult> {
  const { mongoose, acquireDbLock, releaseDbLock } = runtimeContext;
  const timing: Required<RunMigrationsOptions> = {
    sleep: options.sleep || ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))),
    now: options.now || (() => Date.now()),
    waitTimeoutMs: options.waitTimeoutMs ?? MIGRATION_WAIT_TIMEOUT_MS,
    pollIntervalMs: options.pollIntervalMs ?? MIGRATION_WAIT_POLL_MS
  };
  const db = mongoose.connection;
  if (!db.db) {
    logger("WARN", "MIGRATE", "Conexiunea Mongo nu e ready, sar peste migrari");
    return { applied: [], skipped: ALL_MIGRATIONS.length };
  }

  const sysColl = db.collection("system");

  const lockToken = await acquireDbLock(MIGRATION_LOCK_NAME, MIGRATION_LOCK_TTL_MS);
  if (!lockToken) {
    return waitForOtherInstanceMigrations(sysColl, logger, timing);
  }

  try {
    const lastApplied = await readLastApplied(sysColl);

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

function buildMigrationsFrom(context: MigrationsContext) {
  runtimeContext = {
    mongoose: context.mongoose,
    acquireDbLock: context.acquireDbLock,
    releaseDbLock: context.releaseDbLock
  };

  return {
    runMigrations,
    ALL_MIGRATIONS
  };
}

function attachMigrations(target: MigrationsContext): void {
  Object.assign(target, buildMigrationsFrom(target));
}

attachMigrations.buildFrom = buildMigrationsFrom;

export default attachMigrations;
