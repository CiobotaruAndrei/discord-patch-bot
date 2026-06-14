import test from "node:test";
import assert from "node:assert/strict";

import { makeDealInfo, makeNotificationDiscordClient } from "./typedTestBuilders";
const realUtilities = require("../shared/utilities") as { validatePendingDiscountSnapshot: (snapshot: unknown) => boolean; validateUpdateFetchSnapshot: (item: unknown) => boolean };
const noopDiscordClient = makeNotificationDiscordClient();
import { createUpdateNotificationService } from "../features/notifications/updateNotificationService";
import { createDiscountNotificationService } from "../features/notifications/discountNotificationService";
import attachFetchSnapshots = require("../infra/mongo/fetchSnapshots");
import type { GameConfig } from "../types";

type UpdateDeps = Parameters<typeof createUpdateNotificationService>[0];
type DiscountDeps = Parameters<typeof createDiscountNotificationService>[0];
const updateDeps = (deps: Partial<UpdateDeps>): UpdateDeps => deps as UpdateDeps;
const discountDeps = (deps: Partial<DiscountDeps>): DiscountDeps => deps as DiscountDeps;

interface SnapshotDoc { _id: string; payload: unknown; fetchedAt: Date; }

function makeFakeSnapshotModel() {
  const store = new Map<string, SnapshotDoc>();
  return {
    store,
    updateOne: async (filter: { _id: string }, update: { $set: { payload: unknown; fetchedAt: Date } }) => {
      store.set(filter._id, { _id: filter._id, payload: update.$set.payload, fetchedAt: update.$set.fetchedAt });
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 1 };
    },
    findById: (id: string) => ({ lean: async () => store.get(id) || null }),
    find: (query: { _id: { $regex: string } }) => ({
      lean: async () => {
        const re = new RegExp(query._id.$regex);
        return Array.from(store.values()).filter(doc => re.test(doc._id));
      }
    })
  };
}

type FetchSnapshotsContext = Parameters<typeof attachFetchSnapshots>[0];
interface RepoMethods {
  saveFetchSnapshot: (id: string, payload: unknown) => Promise<void>;
  loadFetchSnapshot: (id: string) => Promise<{ payload: unknown; fetchedAt: Date } | null>;
  loadDealsFetchSnapshots: () => Promise<Array<{ currency: string; payload: unknown; fetchedAt: Date }>>;
}

function attachRepo(): FetchSnapshotsContext & RepoMethods {
  const target: FetchSnapshotsContext = {
    FetchSnapshotModel: makeFakeSnapshotModel(),
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  };
  attachFetchSnapshots(target);
  const { saveFetchSnapshot, loadFetchSnapshot, loadDealsFetchSnapshots } = target;
  if (!saveFetchSnapshot || !loadFetchSnapshot || !loadDealsFetchSnapshots) {
    throw new Error("attachFetchSnapshots trebuie sa ataseze metodele de snapshot");
  }
  return Object.assign(target, { saveFetchSnapshot, loadFetchSnapshot, loadDealsFetchSnapshots });
}

test("fetchSnapshots: save apoi load intoarce acelasi payload + un fetchedAt Date", async () => {
  const repo = attachRepo();
  await repo.saveFetchSnapshot("updates", [{ game: { key: "cs2" }, latest: { id: "u-1" } }]);
  const loaded = await repo.loadFetchSnapshot("updates");
  assert.ok(loaded, "snapshot-ul trebuie sa existe dupa save");
  assert.deepEqual(loaded.payload, [{ game: { key: "cs2" }, latest: { id: "u-1" } }]);
  assert.ok(loaded.fetchedAt instanceof Date, "fetchedAt este Date");
});

test("fetchSnapshots: loadFetchSnapshot intoarce null cand nu exista", async () => {
  const repo = attachRepo();
  assert.equal(await repo.loadFetchSnapshot("updates"), null);
});

test("fetchSnapshots: loadDealsFetchSnapshots intoarce doar cheile deals:* cu moneda extrasa", async () => {
  const repo = attachRepo();
  await repo.saveFetchSnapshot("updates", [{ id: "u" }]);
  await repo.saveFetchSnapshot("deals:USD", [{ id: "d1" }]);
  await repo.saveFetchSnapshot("deals:EUR", [{ id: "d2" }]);
  const deals = await repo.loadDealsFetchSnapshots();
  const byCurrency = new Map(deals.map(entry => [entry.currency, entry.payload]));
  assert.equal(deals.length, 2, "doar snapshot-urile de reduceri");
  assert.deepEqual(byCurrency.get("USD"), [{ id: "d1" }]);
  assert.deepEqual(byCurrency.get("EUR"), [{ id: "d2" }]);
});

test("UpdateService.checkForUpdates persista snapshot-ul 'updates' dupa fetch (lista completa)", async () => {
  const persistCalls: Array<{ id: string; payload: unknown }> = [];
  const guild = { _id: "g1", subscribed: true, notificationChannelId: "channel-1", seen: {}, pendingUpdates: {}, enabledGames: [] };
  const deps = {
    GuildModel: { find: () => ({ lean: async () => [guild] }), updateOne: async () => ({ matchedCount: 1 }) },
    logger: () => undefined,
    runConcurrent: async <T>(items: T[], _c: number, fn: (item: T) => Promise<unknown>) => {
      let processed = 0;
      const errors: Array<{ error: unknown }> = [];
      for (const it of items) {
        try { await fn(it); processed++; } catch (error) { errors.push({ error }); }
      }
      return { processed, errors };
    },
    resolveOutboundChannel: async () => ({ channel: null, abort: true }),
    getLatestForAllGames: async (games: GameConfig[]) => games.map(game => ({ game, latest: { id: `u-${game.key}` } })),
    setUpdatesCache: () => undefined,
    persistFetchSnapshot: async (id: string, payload: unknown) => { persistCalls.push({ id, payload }); }
  } satisfies Partial<UpdateDeps>;
  const svc = createUpdateNotificationService(updateDeps(deps));
  await svc.checkForUpdates(noopDiscordClient, [{ key: "cs2", name: "CS2" }, { key: "fortnite", name: "Fortnite" }]);
  assert.equal(persistCalls.length, 1, "exact un snapshot persistat");
  assert.equal(persistCalls[0].id, "updates");
  assert.deepEqual(persistCalls[0].payload, [
    { game: { key: "cs2", name: "CS2" }, latest: { id: "u-cs2" } },
    { game: { key: "fortnite", name: "Fortnite" }, latest: { id: "u-fortnite" } }
  ]);
});

test("DiscountService.checkForDiscounts persista snapshot-ul 'deals:<MONEDA>' dupa fetch", async () => {
  const persistCalls: Array<{ id: string; payload: unknown }> = [];
  const guild = { _id: "g1", discountsSubscribed: true, discountChannelId: "channel-d", seenDiscounts: [], pendingDiscounts: [], currency: "USD" };
  const deps = {
    GuildModel: { find: () => ({ lean: async () => [guild] }), updateOne: async () => ({ matchedCount: 1 }) },
    logger: () => undefined,
    runConcurrent: async <T>(items: T[], _c: number, fn: (item: T) => Promise<unknown>) => {
      let processed = 0;
      const errors: Array<{ error: unknown }> = [];
      for (const it of items) {
        try { await fn(it); processed++; } catch (error) { errors.push({ error }); }
      }
      return { processed, errors };
    },
    resolveOutboundChannel: async () => ({ channel: null, abort: true }),
    normalizeCurrencyKey: (currency: unknown) => String(currency || "USD").toUpperCase(),
    getDealsCacheData: () => null,
    fetchDeals: async () => [{ id: "d1" }],
    setDealsCache: () => undefined,
    persistFetchSnapshot: async (id: string, payload: unknown) => { persistCalls.push({ id, payload }); },
    DEFAULT_CURRENCY: "USD",
    GUILD_PROCESS_CONCURRENCY: 1
  } satisfies Partial<DiscountDeps>;
  const svc = createDiscountNotificationService(discountDeps(deps));
  await svc.checkForDiscounts(noopDiscordClient);
  assert.equal(persistCalls.length, 1, "exact un snapshot de reduceri persistat");
  assert.equal(persistCalls[0].id, "deals:USD");
  assert.deepEqual(persistCalls[0].payload, [{ id: "d1" }]);
});

const messageOf = (value: unknown) => value instanceof Error ? value.message : String(value);
const runConcurrentSafe = async <T>(items: T[], _c: number, fn: (item: T) => Promise<unknown>, opts?: { errorLogger?: (item: unknown, err: unknown) => void }) => {
  let processed = 0;
  const errors: Array<{ error: unknown }> = [];
  for (const it of items) {
    try { await fn(it); processed++; } catch (err) { opts?.errorLogger?.(it, err); errors.push({ error: err }); }
  }
  return { processed, errors };
};

test("UpdateService.checkForUpdates: fetch esuat foloseste snapshot-ul din event store (dispatch continua)", async () => {
  let resolveCalls = 0;
  const guild = { _id: "g1", subscribed: true, notificationChannelId: "channel-1", seen: {}, pendingUpdates: {}, enabledGames: [] };
  const deps = {
    GuildModel: { find: () => ({ lean: async () => [guild] }), updateOne: async () => ({ matchedCount: 1 }) },
    logger: () => undefined,
    runConcurrent: runConcurrentSafe,
    resolveOutboundChannel: async () => { resolveCalls++; return { channel: null, abort: true }; },
    transientErrorMessage: messageOf,
    getLatestForAllGames: async () => { throw new Error("fetch down"); },
    validateUpdateFetchSnapshot: realUtilities.validateUpdateFetchSnapshot,
    loadFetchSnapshot: async () => ({ payload: [{ game: { key: "cs2", name: "CS2" }, latest: { id: "u-cs2" } }], fetchedAt: new Date() })
  } satisfies Partial<UpdateDeps>;
  const svc = createUpdateNotificationService(updateDeps(deps));
  await svc.checkForUpdates(noopDiscordClient, [{ key: "cs2", name: "CS2" }]);
  assert.equal(resolveCalls, 1, "dispatch-ul a continuat de pe snapshot dupa esecul fetch-ului");
});

test("UpdateService.checkForUpdates: fetch esuat fara snapshot arunca (fara dispatch, cron vede esecul)", async () => {
  let resolveCalls = 0;
  const guild = { _id: "g1", subscribed: true, notificationChannelId: "channel-1", seen: {}, pendingUpdates: {}, enabledGames: [] };
  const deps = {
    GuildModel: { find: () => ({ lean: async () => [guild] }), updateOne: async () => ({ matchedCount: 1 }) },
    logger: () => undefined,
    runConcurrent: runConcurrentSafe,
    resolveOutboundChannel: async () => { resolveCalls++; return { channel: null, abort: true }; },
    transientErrorMessage: messageOf,
    getLatestForAllGames: async () => { throw new Error("fetch down"); },
    validateUpdateFetchSnapshot: realUtilities.validateUpdateFetchSnapshot,
    loadFetchSnapshot: async () => null
  } satisfies Partial<UpdateDeps>;
  const svc = createUpdateNotificationService(updateDeps(deps));
  await assert.rejects(() => svc.checkForUpdates(noopDiscordClient, [{ key: "cs2", name: "CS2" }]), /snapshot de rezerva proaspat.*fetch down/);
  assert.equal(resolveCalls, 0, "fara snapshot, ciclul se opreste inainte de dispatch");
});

test("DiscountService.checkForDiscounts: fetch esuat foloseste snapshot-ul de reduceri (dispatch continua)", async () => {
  let resolveCalls = 0;
  const guild = { _id: "g1", discountsSubscribed: true, discountChannelId: "channel-d", seenDiscounts: [], pendingDiscounts: [], currency: "USD" };
  const deps = {
    GuildModel: { find: () => ({ lean: async () => [guild] }), updateOne: async () => ({ matchedCount: 1 }) },
    logger: () => undefined,
    runConcurrent: runConcurrentSafe,
    resolveOutboundChannel: async () => { resolveCalls++; return { channel: null, abort: true }; },
    transientErrorMessage: messageOf,
    normalizeCurrencyKey: (currency: unknown) => String(currency || "USD").toUpperCase(),
    getDealsCacheData: () => null,
    fetchDeals: async () => { throw new Error("deals down"); },
    validatePendingDiscountSnapshot: realUtilities.validatePendingDiscountSnapshot,
    loadFetchSnapshot: async () => ({ payload: [makeDealInfo({ id: "d1" })], fetchedAt: new Date() }),
    DEFAULT_CURRENCY: "USD",
    GUILD_PROCESS_CONCURRENCY: 1
  } satisfies Partial<DiscountDeps>;
  const svc = createDiscountNotificationService(discountDeps(deps));
  await svc.checkForDiscounts(noopDiscordClient);
  assert.equal(resolveCalls, 1, "dispatch-ul a continuat de pe snapshot dupa esecul fetch-ului de reduceri");
});

test("DiscountService.checkForDiscounts: fetch esuat fara snapshot sare guild-ul (fara dispatch)", async () => {
  let resolveCalls = 0;
  const guild = { _id: "g1", discountsSubscribed: true, discountChannelId: "channel-d", seenDiscounts: [], pendingDiscounts: [], currency: "USD" };
  const deps = {
    GuildModel: { find: () => ({ lean: async () => [guild] }), updateOne: async () => ({ matchedCount: 1 }) },
    logger: () => undefined,
    runConcurrent: runConcurrentSafe,
    resolveOutboundChannel: async () => { resolveCalls++; return { channel: null, abort: true }; },
    transientErrorMessage: messageOf,
    normalizeCurrencyKey: (currency: unknown) => String(currency || "USD").toUpperCase(),
    getDealsCacheData: () => null,
    fetchDeals: async () => { throw new Error("deals down"); },
    validatePendingDiscountSnapshot: realUtilities.validatePendingDiscountSnapshot,
    loadFetchSnapshot: async () => null,
    DEFAULT_CURRENCY: "USD",
    GUILD_PROCESS_CONCURRENCY: 1
  } satisfies Partial<DiscountDeps>;
  const svc = createDiscountNotificationService(discountDeps(deps));
  await assert.rejects(() => svc.checkForDiscounts(noopDiscordClient), /toate cele 1 guild-uri abonate.*deals down/);
  assert.equal(resolveCalls, 0, "fara snapshot, niciun dispatch");
});

test("UpdateService.checkForUpdates: snapshot proaspat dar CORUPT nu trece de validator -> fara dispatch (review #17.1)", async () => {
  let resolveCalls = 0;
  const guild = { _id: "g1", subscribed: true, notificationChannelId: "channel-1", seen: {}, pendingUpdates: {}, enabledGames: [] };
  const deps = {
    GuildModel: { find: () => ({ lean: async () => [guild] }), updateOne: async () => ({ matchedCount: 1 }) },
    logger: () => undefined,
    runConcurrent: runConcurrentSafe,
    resolveOutboundChannel: async () => { resolveCalls++; return { channel: null, abort: true }; },
    transientErrorMessage: messageOf,
    getLatestForAllGames: async () => { throw new Error("fetch down"); },
    validateUpdateFetchSnapshot: realUtilities.validateUpdateFetchSnapshot,
    loadFetchSnapshot: async () => ({ payload: [{ bogus: true }, 42, { game: { key: "cs2" } }], fetchedAt: new Date() })
  } satisfies Partial<UpdateDeps>;
  const svc = createUpdateNotificationService(updateDeps(deps));
  await assert.rejects(() => svc.checkForUpdates(noopDiscordClient, [{ key: "cs2", name: "CS2" }]), /snapshot de rezerva proaspat/);
  assert.equal(resolveCalls, 0, "snapshot corupt = fallback invalid, niciun dispatch pe date neverificate");
});

test("DiscountService.checkForDiscounts: snapshot proaspat dar CORUPT (itemii nu trec validatorul DealInfo) -> fara dispatch (review #17.1)", async () => {
  let resolveCalls = 0;
  const guild = { _id: "g1", discountsSubscribed: true, discountChannelId: "channel-d", seenDiscounts: [], pendingDiscounts: [], currency: "USD" };
  const deps = {
    GuildModel: { find: () => ({ lean: async () => [guild] }), updateOne: async () => ({ matchedCount: 1 }) },
    logger: () => undefined,
    runConcurrent: runConcurrentSafe,
    resolveOutboundChannel: async () => { resolveCalls++; return { channel: null, abort: true }; },
    transientErrorMessage: messageOf,
    normalizeCurrencyKey: (currency: unknown) => String(currency || "USD").toUpperCase(),
    getDealsCacheData: () => null,
    fetchDeals: async () => { throw new Error("deals down"); },
    validatePendingDiscountSnapshot: realUtilities.validatePendingDiscountSnapshot,
    loadFetchSnapshot: async () => ({ payload: [{ id: "doar-id-fara-restul" }, null, "text"], fetchedAt: new Date() }),
    DEFAULT_CURRENCY: "USD",
    GUILD_PROCESS_CONCURRENCY: 1
  } satisfies Partial<DiscountDeps>;
  const svc = createDiscountNotificationService(discountDeps(deps));
  await assert.rejects(() => svc.checkForDiscounts(noopDiscordClient), /deals down/);
  assert.equal(resolveCalls, 0, "snapshot corupt = fallback invalid, niciun dispatch pe date neverificate");
});

const STALE_FETCHED_AT = new Date(Date.now() - 61 * 60 * 1000);

test("UpdateService.checkForUpdates: snapshot vechi (>60min) NU este folosit ca fallback", async () => {
  let resolveCalls = 0;
  const guild = { _id: "g1", subscribed: true, notificationChannelId: "channel-1", seen: {}, pendingUpdates: {}, enabledGames: [] };
  const deps = {
    GuildModel: { find: () => ({ lean: async () => [guild] }), updateOne: async () => ({ matchedCount: 1 }) },
    logger: () => undefined,
    runConcurrent: runConcurrentSafe,
    resolveOutboundChannel: async () => { resolveCalls++; return { channel: null, abort: true }; },
    transientErrorMessage: messageOf,
    getLatestForAllGames: async () => { throw new Error("fetch down"); },
    validateUpdateFetchSnapshot: realUtilities.validateUpdateFetchSnapshot,
    loadFetchSnapshot: async () => ({ payload: [{ game: { key: "cs2", name: "CS2" }, latest: { id: "u-cs2" } }], fetchedAt: STALE_FETCHED_AT })
  } satisfies Partial<UpdateDeps>;
  const svc = createUpdateNotificationService(updateDeps(deps));
  await assert.rejects(() => svc.checkForUpdates(noopDiscordClient, [{ key: "cs2", name: "CS2" }]), /snapshot de rezerva proaspat/);
  assert.equal(resolveCalls, 0, "snapshot expirat -> ciclul se opreste, fara dispatch pe date vechi");
});

test("DiscountService.checkForDiscounts: snapshot vechi (>60min) NU este folosit ca fallback", async () => {
  let resolveCalls = 0;
  const guild = { _id: "g1", discountsSubscribed: true, discountChannelId: "channel-d", seenDiscounts: [], pendingDiscounts: [], currency: "USD" };
  const deps = {
    GuildModel: { find: () => ({ lean: async () => [guild] }), updateOne: async () => ({ matchedCount: 1 }) },
    logger: () => undefined,
    runConcurrent: runConcurrentSafe,
    resolveOutboundChannel: async () => { resolveCalls++; return { channel: null, abort: true }; },
    transientErrorMessage: messageOf,
    normalizeCurrencyKey: (currency: unknown) => String(currency || "USD").toUpperCase(),
    getDealsCacheData: () => null,
    fetchDeals: async () => { throw new Error("deals down"); },
    validatePendingDiscountSnapshot: realUtilities.validatePendingDiscountSnapshot,
    loadFetchSnapshot: async () => ({ payload: [makeDealInfo({ id: "d1" })], fetchedAt: STALE_FETCHED_AT }),
    DEFAULT_CURRENCY: "USD",
    GUILD_PROCESS_CONCURRENCY: 1
  } satisfies Partial<DiscountDeps>;
  const svc = createDiscountNotificationService(discountDeps(deps));
  await assert.rejects(() => svc.checkForDiscounts(noopDiscordClient), /toate cele 1 guild-uri abonate/);
  assert.equal(resolveCalls, 0, "snapshot expirat -> fara dispatch pe date vechi");
});
