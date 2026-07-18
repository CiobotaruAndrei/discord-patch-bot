import test from "node:test";
import assert from "node:assert/strict";
import {
  composeMongoContextBundles,
  type MongoRepositoriesBundle,
  type MongoLocksBundle,
  type MongoMigrationsBundle,
  type MongoSnapshotsBundle,
  type MongoAdministrationBundle
} from "../../infra/mongo/mongoContextBundles.js";

type MongoContextValue = typeof import("../../infra/mongo/mongoContext.js")["default"];

type StrictSliceOf<Full, B> = Full extends B ? (B extends Full ? never : true) : never;
type NoOverlap<A, B> = [Extract<keyof A, keyof B>] extends [never] ? true : never;

const repositoriesIsStrictSlice: StrictSliceOf<MongoContextValue, MongoRepositoriesBundle> = true;
const locksIsStrictSlice: StrictSliceOf<MongoContextValue, MongoLocksBundle> = true;
const migrationsIsStrictSlice: StrictSliceOf<MongoContextValue, MongoMigrationsBundle> = true;
const snapshotsIsStrictSlice: StrictSliceOf<MongoContextValue, MongoSnapshotsBundle> = true;
const administrationIsStrictSlice: StrictSliceOf<MongoContextValue, MongoAdministrationBundle> = true;

const bundlesAreDisjoint: [
  NoOverlap<MongoRepositoriesBundle, MongoLocksBundle>,
  NoOverlap<MongoRepositoriesBundle, MongoMigrationsBundle>,
  NoOverlap<MongoRepositoriesBundle, MongoSnapshotsBundle>,
  NoOverlap<MongoRepositoriesBundle, MongoAdministrationBundle>,
  NoOverlap<MongoLocksBundle, MongoMigrationsBundle>,
  NoOverlap<MongoLocksBundle, MongoSnapshotsBundle>,
  NoOverlap<MongoLocksBundle, MongoAdministrationBundle>,
  NoOverlap<MongoMigrationsBundle, MongoSnapshotsBundle>,
  NoOverlap<MongoMigrationsBundle, MongoAdministrationBundle>,
  NoOverlap<MongoSnapshotsBundle, MongoAdministrationBundle>
] = [true, true, true, true, true, true, true, true, true, true];

function contextStub(): MongoContextValue {
  const memo: Record<string, unknown> = {};
  return new Proxy({}, {
    get(_target, property: string) {
      memo[property] ??= { bundleKey: property };
      return memo[property];
    }
  }) as MongoContextValue;
}

test("mongoContext se descompune in bundle-uri coezive injectate din composition root (review nou, Mare #3)", () => {
  assert.equal(repositoriesIsStrictSlice, true, "repositories e o felie STRICT mai mica din mongoContext");
  assert.equal(locksIsStrictSlice, true, "locks e o felie STRICT mai mica din mongoContext");
  assert.equal(migrationsIsStrictSlice, true, "migrations e o felie STRICT mai mica din mongoContext");
  assert.equal(snapshotsIsStrictSlice, true, "snapshots e o felie STRICT mai mica din mongoContext");
  assert.equal(administrationIsStrictSlice, true, "administration e o felie STRICT mai mica din mongoContext");
  assert.deepEqual(bundlesAreDisjoint, [true, true, true, true, true, true, true, true, true, true], "bundle-urile nu impart nicio cheie - fiecare membru apartine unui singur bundle");
});

test("composeMongoContextBundles ruteaza fiecare membru catre bundle-ul corect si nu scurge intre bundle-uri", () => {
  const bundles = composeMongoContextBundles(contextStub());

  assert.equal(Object.keys(bundles.repositories).length, 26, "toate cele 26 de modele sunt in bundle-ul repositories");
  assert.equal(Object.keys(bundles.locks).length, 4, "cele 4 primitive de lock sunt in bundle-ul locks");
  assert.equal(Object.keys(bundles.migrations).length, 2, "runMigrations + ALL_MIGRATIONS in bundle-ul migrations");
  assert.equal(Object.keys(bundles.snapshots).length, 4, "cele 4 operatii de snapshot in bundle-ul snapshots");
  assert.equal(Object.keys(bundles.administration).length, 2, "adminAlert + setAdminAlertDiscordClient in bundle-ul administration");

  assert.ok(bundles.repositories.GuildModel !== undefined, "repositories expune GuildModel");
  assert.ok(bundles.locks.acquireDbLock !== undefined, "locks expune acquireDbLock");
  assert.ok(bundles.snapshots.saveFetchSnapshot !== undefined, "snapshots expune saveFetchSnapshot");
  assert.ok(bundles.administration.adminAlert !== undefined, "administration expune adminAlert");

  assert.ok(!("acquireDbLock" in bundles.repositories), "lock-urile nu se scurg in repositories");
  assert.ok(!("GuildModel" in bundles.locks), "modelele nu se scurg in locks");
  assert.ok(!("adminAlert" in bundles.snapshots), "administrarea nu se scurge in snapshots");
});
