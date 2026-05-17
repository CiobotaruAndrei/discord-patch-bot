// @ts-check
"use strict";

module.exports = (ctx) => {
  const { mongoose, acquireDbLock, releaseDbLock } = ctx;

/** @typedef {{ id: number, name: string, up: (db: import("mongoose").Connection) => Promise<void> }} Migration */

/** @type {Migration} */
const m1_addEnabledStores = {
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

/** @type {Migration} */
const m2_addMaxAbsolutePrice = {
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

/** @type {Migration} */
const m3_addEnabledGames = {
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

/** @type {Migration} */
const m4_trimSeenDiscounts = {
  id: 4,
  name: "trim-runaway-seenDiscounts",
  async up(db) {
    const coll = db.collection("guilds");
    const docs = await coll.find(
      { "seenDiscounts.500": { $exists: true } },
      { projection: { _id: 1, seenDiscounts: 1 } }
    ).toArray();

    for (const doc of docs) {
      if (!Array.isArray(doc.seenDiscounts)) continue;
      const trimmed = doc.seenDiscounts.slice(-300);
      await coll.updateOne({ _id: doc._id }, { $set: { seenDiscounts: trimmed } });
    }
  }
};

/** @type {Migration[]} */
const ALL_MIGRATIONS = [
  m1_addEnabledStores,
  m2_addMaxAbsolutePrice,
  m3_addEnabledGames,
  m4_trimSeenDiscounts
];

const MIGRATION_LOCK_NAME = "db_migrations";
const MIGRATION_LOCK_TTL_MS = 5 * 60 * 1000;

/**
 * @param {(level: string, ctx: string, msg: string, meta?: unknown) => void} logger
 * @returns {Promise<{ applied: number[], skipped: number }>}
 */
async function runMigrations(logger) {
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
    const sysColl = db.collection("system");
    const stateDoc = await sysColl.findOne({ _id: "migrationState" });
    const lastApplied = stateDoc && typeof stateDoc.lastApplied === "number"
      ? stateDoc.lastApplied
      : 0;

    /** @type {number[]} */
    const applied = [];
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

  Object.assign(ctx, {
    runMigrations,
    ALL_MIGRATIONS
  });
};
