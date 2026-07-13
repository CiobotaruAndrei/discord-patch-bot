import type { LockToken, LoggerFunction } from "../../types.js";

interface MigrationCollectionLike {
  updateMany(filter: object, update: object): Promise<unknown>;
  updateOne(filter: object, update: object, options?: object): Promise<unknown>;
  findOne(filter: object): Promise<Record<string, unknown> | null>;
  bulkWrite(ops: object[], options?: object): Promise<unknown>;
  find(filter?: object, options?: object): AsyncIterable<Record<string, unknown>>;
}

interface MigrationConnectionLike {
  db?: unknown;
  collection(name: string): MigrationCollectionLike;
}

interface MigrationMongooseLike {
  connection: MigrationConnectionLike;
}

interface Migration {
  id: number;
  name: string;
  up: (db: MigrationConnectionLike) => Promise<void>;
}

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

const m5_backfillSeenDiscounts: Migration = {
  id: 5,
  name: "backfill-seenDiscounts-into-collection",
  async up(db) {
    const guilds = db.collection("guilds");
    const seenColl = db.collection("guildSeenDiscounts");
    const cursor = guilds.find(
      { seenDiscounts: { $exists: true, $ne: [] } },
      { projection: { seenDiscounts: 1 } }
    );
    for await (const guild of cursor) {
      const hashes = Array.isArray(guild.seenDiscounts) ? guild.seenDiscounts : [];
      if (!hashes.length) continue;
      const ops = hashes
        .filter((h: unknown) => typeof h === "string" && h.length > 0)
        .map((h: string) => ({
          updateOne: {
            filter: { guildId: String(guild._id), dealHash: h },
            update: { $setOnInsert: { guildId: String(guild._id), dealHash: h, seenAt: new Date() } },
            upsert: true
          }
        }));
      if (ops.length) await seenColl.bulkWrite(ops, { ordered: false });
    }
  }
};

const m6_backfillSeenUpdates: Migration = {
  id: 6,
  name: "backfill-seen-updates-into-collection",
  async up(db) {
    const guilds = db.collection("guilds");
    const seenColl = db.collection("guildSeenUpdates");
    const cursor = guilds.find(
      { seen: { $exists: true, $ne: {} } },
      { projection: { seen: 1 } }
    );
    for await (const guild of cursor) {
      const seen = guild.seen && typeof guild.seen === "object" ? guild.seen as Record<string, unknown> : {};
      const ops: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown>; upsert: boolean } }> = [];
      for (const [gameKey, rawIds] of Object.entries(seen)) {
        const ids = Array.isArray(rawIds) ? rawIds : [];
        for (const id of ids) {
          if (typeof id !== "string" || !id) continue;
          ops.push({
            updateOne: {
              filter: { guildId: String(guild._id), gameKey, updateId: id },
              update: { $setOnInsert: { guildId: String(guild._id), gameKey, updateId: id, seenAt: new Date() } },
              upsert: true
            }
          });
        }
      }
      if (ops.length) await seenColl.bulkWrite(ops, { ordered: false });
    }
  }
};

const m7_dropLegacySeenFields: Migration = {
  id: 7,
  name: "drop-legacy-seen-fields-from-guilds",
  async up(db) {
    const guilds = db.collection("guilds");
    await guilds.updateMany(
      { $or: [{ seen: { $exists: true } }, { seenDiscounts: { $exists: true } }] },
      { $unset: { seen: "", seenDiscounts: "" } }
    );
  }
};

const m8_moveAuditLogsIntoCollection: Migration = {
  id: 8,
  name: "move-audit-logs-into-collection",
  async up(db) {
    const guilds = db.collection("guilds");
    const auditColl = db.collection("guildAuditLogs");
    const cursor = guilds.find(
      { $or: [{ botAuditLog: { $exists: true } }, { serverAuditLog: { $exists: true } }] },
      { projection: { botAuditLog: 1, serverAuditLog: 1 } }
    );
    for await (const guild of cursor) {
      const guildId = String(guild._id);
      const ops: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown>; upsert: boolean } }> = [];
      const botEntries = Array.isArray(guild.botAuditLog) ? guild.botAuditLog : [];
      for (const raw of botEntries) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as Record<string, unknown>;
        const doc = {
          guildId,
          kind: "bot",
          userId: String(entry.userId || ""),
          command: String(entry.command || ""),
          result: String(entry.result || ""),
          details: String(entry.details || ""),
          at: entry.at instanceof Date ? entry.at : new Date(String(entry.at || 0))
        };
        ops.push({ updateOne: { filter: doc, update: { $setOnInsert: doc }, upsert: true } });
      }
      const serverEntries = Array.isArray(guild.serverAuditLog) ? guild.serverAuditLog : [];
      for (const raw of serverEntries) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as Record<string, unknown>;
        const doc = {
          guildId,
          kind: "server",
          userId: String(entry.userId || ""),
          action: String(entry.action || ""),
          details: String(entry.details || ""),
          at: entry.at instanceof Date ? entry.at : new Date(String(entry.at || 0))
        };
        ops.push({ updateOne: { filter: doc, update: { $setOnInsert: doc }, upsert: true } });
      }
      if (ops.length) await auditColl.bulkWrite(ops, { ordered: false });
      await guilds.updateOne({ _id: guild._id }, { $unset: { botAuditLog: "", serverAuditLog: "" } });
    }
  }
};

const m9_moveConfigBackupsIntoCollection: Migration = {
  id: 9,
  name: "move-config-backups-into-collection",
  async up(db) {
    const guilds = db.collection("guilds");
    const backupColl = db.collection("guildConfigBackups");
    const cursor = guilds.find(
      { configBackups: { $exists: true } },
      { projection: { configBackups: 1 } }
    );
    for await (const guild of cursor) {
      const guildId = String(guild._id);
      const ops: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown>; upsert: boolean } }> = [];
      const backups = Array.isArray(guild.configBackups) ? guild.configBackups : [];
      for (const raw of backups) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as Record<string, unknown>;
        const name = String(entry.name || "");
        if (!name) continue;
        const doc = {
          guildId,
          name,
          createdBy: String(entry.createdBy || ""),
          createdAt: entry.createdAt instanceof Date ? entry.createdAt : new Date(String(entry.createdAt || 0)),
          snapshot: entry.snapshot && typeof entry.snapshot === "object" ? entry.snapshot : {}
        };
        ops.push({ updateOne: { filter: { guildId, name }, update: { $setOnInsert: doc }, upsert: true } });
      }
      if (ops.length) await backupColl.bulkWrite(ops, { ordered: false });
      await guilds.updateOne({ _id: guild._id }, { $unset: { configBackups: "" } });
    }
  }
};

const m10_moveSuggestedCommandsIntoCollection: Migration = {
  id: 10,
  name: "move-suggested-commands-into-collection",
  async up(db) {
    const guilds = db.collection("guilds");
    const suggestedColl = db.collection("guildSuggestedCommands");
    const cursor = guilds.find(
      { suggestedCommands: { $exists: true } },
      { projection: { suggestedCommands: 1 } }
    );
    for await (const guild of cursor) {
      const guildId = String(guild._id);
      const ops: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown>; upsert: boolean } }> = [];
      const entries = Array.isArray(guild.suggestedCommands) ? guild.suggestedCommands : [];
      for (const raw of entries) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as Record<string, unknown>;
        const commandName = String(entry.commandName || "");
        if (!commandName) continue;
        const doc = {
          guildId,
          commandName,
          description: String(entry.description || ""),
          createdBy: String(entry.createdBy || ""),
          createdAt: entry.createdAt instanceof Date ? entry.createdAt : new Date(String(entry.createdAt || 0))
        };
        ops.push({ updateOne: { filter: { guildId, commandName }, update: { $setOnInsert: doc }, upsert: true } });
      }
      if (ops.length) await suggestedColl.bulkWrite(ops, { ordered: false });
      await guilds.updateOne({ _id: guild._id }, { $unset: { suggestedCommands: "" } });
    }
  }
};

const m11_moveYoutubeErrorsIntoCollection: Migration = {
  id: 11,
  name: "move-youtube-errors-into-collection",
  async up(db) {
    const guilds = db.collection("guilds");
    const errorColl = db.collection("guildYoutubeErrors");
    const cursor = guilds.find(
      { youtubeErrors: { $exists: true } },
      { projection: { youtubeErrors: 1 } }
    );
    for await (const guild of cursor) {
      const guildId = String(guild._id);
      const ops: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown>; upsert: boolean } }> = [];
      const entries = Array.isArray(guild.youtubeErrors) ? guild.youtubeErrors : [];
      for (const raw of entries) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as Record<string, unknown>;
        const doc = {
          guildId,
          channelId: String(entry.channelId || ""),
          channelName: String(entry.channelName || ""),
          message: String(entry.message || ""),
          at: entry.at instanceof Date ? entry.at : new Date(String(entry.at || 0))
        };
        ops.push({ updateOne: { filter: doc, update: { $setOnInsert: doc }, upsert: true } });
      }
      if (ops.length) await errorColl.bulkWrite(ops, { ordered: false });
      await guilds.updateOne({ _id: guild._id }, { $unset: { youtubeErrors: "" } });
    }
  }
};

const m12_moveDeadLettersIntoCollection: Migration = {
  id: 12,
  name: "move-dead-letters-into-collection",
  async up(db) {
    const guilds = db.collection("guilds");
    const deadLetterColl = db.collection("guildDeadLetters");
    const cursor = guilds.find(
      { notificationDeadLetter: { $exists: true } },
      { projection: { notificationDeadLetter: 1 } }
    );
    for await (const guild of cursor) {
      const guildId = String(guild._id);
      const ops: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown>; upsert: boolean } }> = [];
      const entries = Array.isArray(guild.notificationDeadLetter) ? guild.notificationDeadLetter : [];
      for (const raw of entries) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as Record<string, unknown>;
        const kind = String(entry.kind || "");
        if (kind !== "update" && kind !== "discount" && kind !== "youtube") continue;
        const doc = {
          guildId,
          kind,
          itemId: String(entry.itemId || ""),
          title: String(entry.title || ""),
          channelId: String(entry.channelId || ""),
          dedupeKey: String(entry.dedupeKey || ""),
          reason: String(entry.reason || ""),
          attempts: Number(entry.attempts) || 0,
          failedAt: entry.failedAt instanceof Date ? entry.failedAt : new Date(String(entry.failedAt || 0))
        };
        ops.push({ updateOne: { filter: doc, update: { $setOnInsert: doc }, upsert: true } });
      }
      if (ops.length) await deadLetterColl.bulkWrite(ops, { ordered: false });
      await guilds.updateOne({ _id: guild._id }, { $unset: { notificationDeadLetter: "" } });
    }
  }
};

const ALL_MIGRATIONS: Migration[] = [
  m1_addEnabledStores,
  m2_addMaxAbsolutePrice,
  m3_addEnabledGames,
  m4_trimSeenDiscounts,
  m5_backfillSeenDiscounts,
  m6_backfillSeenUpdates,
  m7_dropLegacySeenFields,
  m8_moveAuditLogsIntoCollection,
  m9_moveConfigBackupsIntoCollection,
  m10_moveSuggestedCommandsIntoCollection,
  m11_moveYoutubeErrorsIntoCollection,
  m12_moveDeadLettersIntoCollection
];

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
