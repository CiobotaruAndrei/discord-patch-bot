import test from "node:test";
import assert from "node:assert/strict";
import { createUpdateNotificationService } from "../features/notifications/updateNotificationService";
import { createDiscountNotificationService } from "../features/notifications/discountNotificationService";

type UpdateDeps = Parameters<typeof createUpdateNotificationService>[0];
type DiscountDeps = Parameters<typeof createDiscountNotificationService>[0];
type UpdateService = ReturnType<typeof createUpdateNotificationService>;
type DiscountService = ReturnType<typeof createDiscountNotificationService>;
type UpdateGuild = Parameters<UpdateService["processGuildUpdates"]>[1];
type UpdateResults = Parameters<UpdateService["processGuildUpdates"]>[2];
type DiscountGuild = Parameters<DiscountService["processGuildDiscounts"]>[1];
type DiscountDeals = Parameters<DiscountService["processGuildDiscounts"]>[2];
type TestGame = { key: string; name?: string };
type TestDeal = { id: string; title?: string };
type SentPayload = { embeds?: unknown; content?: string };

function entriesFrom(value: unknown): Array<[string, unknown]> {
  if (value instanceof Map) return Array.from(value.entries()).map(([key, val]) => [String(key), val]);
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>);
  return [];
}

function messageOf(value: unknown): string {
  return value && typeof value === "object" && "message" in value
    ? String((value as { message?: unknown }).message || value)
    : String(value);
}

function makeUpdateDeps(overrides: Record<string, unknown> = {}) {
  const updateOneCalls: Array<{ filter: unknown; update: unknown }> = [];
  const sentPayloads: SentPayload[] = [];
  const claims: Array<{ guildId: string; gameKey: string; updateId: string }> = [];
  const rollbacks: Array<{ guildId: string; gameKey: string; updateId: string }> = [];
  const channel = {
    id: "channel-1",
    send: async (payload: SentPayload) => { sentPayloads.push(payload); return { id: "msg-1" }; }
  };
  const deps = {
    GuildModel: {
      find: () => ({ lean: async () => [] }),
      updateOne: async (filter: unknown, update: unknown) => {
        updateOneCalls.push({ filter, update });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    logger: () => undefined,
    runConcurrent: async (items: unknown[], _c: number, fn: (item: unknown) => Promise<void>) => { for (const it of items) await fn(it); },
    resolveOutboundChannel: async () => ({ channel, abort: false }),
    claimSeenUpdate: async (gid: string, _cid: string, gkey: string, uid: string) => {
      claims.push({ guildId: gid, gameKey: gkey, updateId: uid });
      return { matchedCount: 1, modifiedCount: 1 };
    },
    rollbackSeenUpdate: async (gid: string, gkey: string, uid: string) => {
      rollbacks.push({ guildId: gid, gameKey: gkey, updateId: uid });
      return { matchedCount: 1, modifiedCount: 1 };
    },
    disableUpdatesForChannelError: async () => ({ matchedCount: 1, modifiedCount: 1 }),
    isPermanentDiscordError: () => false,
    transientErrorMessage: messageOf,
    normalizePendingUpdateArray: (arr: unknown) => Array.isArray(arr) ? arr : [],
    toEntries: entriesFrom,
    rotateAfter: (keys: string[], lastKey: string | null) => {
      if (!lastKey) return keys;
      const idx = keys.indexOf(lastKey);
      if (idx === -1) return keys;
      return [...keys.slice(idx + 1), ...keys.slice(0, idx + 1)];
    },
    mapToObject: (m: Map<string, unknown>) => Object.fromEntries(m.entries()),
    getLatestForAllGames: async (games: TestGame[]) => games.map(game => ({ game, latest: { id: `u-${game.key}` } })),
    setUpdatesCache: () => undefined,
    buildUpdateEmbed: (name: string) => ({ title: name }),
    sleepIfPositive: async () => undefined,
    PENDING_UPDATE_MAX_AGE_MS: 86_400_000,
    PENDING_UPDATE_MAX_ATTEMPTS: 5,
    PENDING_UPDATES_PER_GAME_LIMIT: 10,
    MAX_UPDATES_PER_CYCLE: 5,
    DISCORD_SEND_DELAY_MS: 0,
    GUILD_PROCESS_CONCURRENCY: 1,
    ...overrides
  };
  return { deps: deps as unknown as UpdateDeps, updateOneCalls, sentPayloads, claims, rollbacks, channel };
}

test("UpdateService: buildOptimizedGameList filtreaza la jocurile active pe macar un guild", () => {
  const { deps } = makeUpdateDeps();
  const svc = createUpdateNotificationService(deps);
  const games = [{ key: "cs2" }, { key: "fortnite" }, { key: "dota2" }];
  const guilds = [
    { enabledGames: ["cs2", "fortnite"] },
    { enabledGames: ["fortnite"] }
  ];
  const filtered = svc.buildOptimizedGameList(games, guilds);
  assert.deepEqual(filtered.map(g => g.key), ["cs2", "fortnite"]);
});

test("UpdateService: buildOptimizedGameList returneaza toata lista cand un guild are filter gol", () => {
  const { deps } = makeUpdateDeps();
  const svc = createUpdateNotificationService(deps);
  const games = [{ key: "cs2" }, { key: "fortnite" }];
  const guilds = [
    { enabledGames: ["cs2"] },
    { enabledGames: [] }
  ];
  assert.deepEqual(svc.buildOptimizedGameList(games, guilds).map(g => g.key), ["cs2", "fortnite"]);
});

test("UpdateService: checkForUpdates scrie cache cand lista nu e filtrata (full list)", async () => {
  let cacheWrites = 0;
  const guild = { _id: "g1", subscribed: true, notificationChannelId: "channel-1", seen: {}, pendingUpdates: {}, enabledGames: [] };
  const { deps } = makeUpdateDeps({
    GuildModel: { find: () => ({ lean: async () => [guild] }), updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }) },
    setUpdatesCache: () => { cacheWrites++; }
  });
  const svc = createUpdateNotificationService(deps);
  await svc.checkForUpdates({}, [{ key: "cs2" }, { key: "fortnite" }]);
  assert.equal(cacheWrites, 1, "lista completa → cache scris exact o data");
});

test("UpdateService: checkForUpdates NU scrie cache cand lista e filtrata (subset)", async () => {
  let cacheWrites = 0;
  const guild = { _id: "g1", subscribed: true, notificationChannelId: "channel-1", seen: {}, pendingUpdates: {}, enabledGames: ["cs2"] };
  const { deps } = makeUpdateDeps({
    GuildModel: { find: () => ({ lean: async () => [guild] }), updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }) },
    setUpdatesCache: () => { cacheWrites++; }
  });
  const svc = createUpdateNotificationService(deps);
  await svc.checkForUpdates({}, [{ key: "cs2" }, { key: "fortnite" }]);
  assert.equal(cacheWrites, 0, "subset filtrat → cache global nu trebuie scris (ar fi partial)");
});

test("UpdateService: processGuildUpdates trimite update + ping rol pe prima trimitere", async () => {
  const { deps, sentPayloads, claims } = makeUpdateDeps();
  const svc = createUpdateNotificationService(deps);
  const guild = {
    _id: "guild-1",
    subscribed: true,
    notificationChannelId: "channel-1",
    notificationRoleId: "role-42",
    notificationMode: "detailed",
    seen: {},
    pendingUpdates: {},
    enabledGames: []
  } as UpdateGuild;
  const latestResults = [
    { game: { key: "cs2", name: "CS2" }, latest: { id: "u-cs2", title: "patch" } }
  ] as UpdateResults;
  await svc.processGuildUpdates({}, guild, latestResults);
  assert.equal(sentPayloads.length, 1);
  assert.equal(sentPayloads[0].content, "<@&role-42>", "rol ping pe prima trimitere");
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0], { guildId: "guild-1", gameKey: "cs2", updateId: "u-cs2" });
});

test("UpdateService: mai multe update-uri sunt grupate intr-un singur mesaj cu mai multe embed-uri", async () => {
  const { deps, sentPayloads, claims } = makeUpdateDeps();
  const svc = createUpdateNotificationService(deps);
  const guild = {
    _id: "guild-1", subscribed: true, notificationChannelId: "channel-1",
    notificationRoleId: "role-7", seen: {}, pendingUpdates: {}, enabledGames: []
  } as UpdateGuild;
  const latestResults = [
    { game: { key: "cs2", name: "CS2" }, latest: { id: "u-cs2", title: "a" } },
    { game: { key: "fortnite", name: "Fortnite" }, latest: { id: "u-fn", title: "b" } },
    { game: { key: "dota2", name: "Dota2" }, latest: { id: "u-dota", title: "c" } }
  ] as UpdateResults;
  await svc.processGuildUpdates({}, guild, latestResults);
  assert.equal(sentPayloads.length, 1, "3 update-uri intr-un singur mesaj batch");
  assert.equal((sentPayloads[0].embeds as unknown[]).length, 3, "3 embed-uri in mesaj");
  assert.equal(sentPayloads[0].content, "<@&role-7>", "ping rol pe mesajul batch");
  assert.equal(claims.length, 3, "fiecare update este claim-uit inainte de trimitere");
});

test("UpdateService: claim race (matchedCount=0) sare item-ul fara send sau rollback", async () => {
  const { deps, sentPayloads, rollbacks } = makeUpdateDeps({
    claimSeenUpdate: async () => ({ matchedCount: 0, modifiedCount: 0 })
  });
  const svc = createUpdateNotificationService(deps);
  const guild = {
    _id: "guild-1", subscribed: true, notificationChannelId: "channel-1",
    seen: {}, pendingUpdates: {}, enabledGames: []
  } as UpdateGuild;
  const latestResults = [{ game: { key: "cs2", name: "CS2" }, latest: { id: "u-1" } }] as UpdateResults;
  await svc.processGuildUpdates({}, guild, latestResults);
  assert.equal(sentPayloads.length, 0, "nu trebuie sa trimitem cand claim-ul nu ne-a aprins");
  assert.equal(rollbacks.length, 0, "nu rollback daca n-am claim-uit");
});

test("UpdateService: send fail (transient) rollback claim si retry next cycle", async () => {
  let sendCallCount = 0;
  const channel = {
    id: "channel-1",
    send: async () => {
      sendCallCount++;
      throw new Error("ECONNRESET");
    }
  };
  const { deps, rollbacks } = makeUpdateDeps({
    resolveOutboundChannel: async () => ({ channel, abort: false })
  });
  const svc = createUpdateNotificationService(deps);
  const guild = {
    _id: "guild-1", subscribed: true, notificationChannelId: "channel-1",
    seen: {}, pendingUpdates: {}, enabledGames: []
  } as UpdateGuild;
  const latestResults = [{ game: { key: "cs2", name: "CS2" }, latest: { id: "u-1" } }] as UpdateResults;
  await svc.processGuildUpdates({}, guild, latestResults);
  assert.equal(sendCallCount, 1);
  assert.equal(rollbacks.length, 1, "rollback obligatoriu pe transient fail");
});

test("UpdateService: livrarea care epuizeaza retry-urile intra in dead-letter (capat $push)", async () => {
  const channel = { id: "channel-1", send: async () => { throw new Error("ECONNRESET"); } };
  const { deps, updateOneCalls } = makeUpdateDeps({
    resolveOutboundChannel: async () => ({ channel, abort: false }),
    PENDING_UPDATE_MAX_ATTEMPTS: 1
  });
  const svc = createUpdateNotificationService(deps);
  const guild = {
    _id: "guild-1", subscribed: true, notificationChannelId: "channel-1",
    seen: {}, pendingUpdates: {}, enabledGames: []
  } as UpdateGuild;
  const latestResults = [{ game: { key: "cs2", name: "CS2" }, latest: { id: "u-1", title: "patch" } }] as UpdateResults;
  await svc.processGuildUpdates({}, guild, latestResults);
  assert.equal(updateOneCalls.length, 1);
  const update = updateOneCalls[0].update as { $push?: { notificationDeadLetter?: { $each?: unknown[] } } };
  const entries = (update.$push?.notificationDeadLetter?.$each || []) as Array<{ kind: string; itemId: string; attempts: number }>;
  assert.equal(entries.length, 1, "un item epuizat -> o intrare dead-letter");
  assert.deepEqual(
    { kind: entries[0].kind, itemId: entries[0].itemId, attempts: entries[0].attempts },
    { kind: "update", itemId: "u-1", attempts: 1 }
  );
});

test("UpdateService: un retry sub max NU scrie dead-letter (fara $push)", async () => {
  const channel = { id: "channel-1", send: async () => { throw new Error("ECONNRESET"); } };
  const { deps, updateOneCalls } = makeUpdateDeps({
    resolveOutboundChannel: async () => ({ channel, abort: false }),
    PENDING_UPDATE_MAX_ATTEMPTS: 5
  });
  const svc = createUpdateNotificationService(deps);
  const guild = {
    _id: "guild-1", subscribed: true, notificationChannelId: "channel-1",
    seen: {}, pendingUpdates: {}, enabledGames: []
  } as UpdateGuild;
  const latestResults = [{ game: { key: "cs2", name: "CS2" }, latest: { id: "u-1" } }] as UpdateResults;
  await svc.processGuildUpdates({}, guild, latestResults);
  const update = updateOneCalls[0].update as { $push?: unknown };
  assert.equal(update.$push, undefined, "cat timp se mai poate reincerca, nu scriem dead-letter");
});

test("UpdateService: enabledGames filter sare jocurile ne-active", async () => {
  const { deps, sentPayloads } = makeUpdateDeps();
  const svc = createUpdateNotificationService(deps);
  const guild = {
    _id: "guild-1", subscribed: true, notificationChannelId: "channel-1",
    seen: {}, pendingUpdates: {},
    enabledGames: ["cs2"]
  } as UpdateGuild;
  const latestResults = [
    { game: { key: "cs2", name: "CS2" }, latest: { id: "u-cs2" } },
    { game: { key: "fortnite", name: "Fortnite" }, latest: { id: "u-fn" } }
  ] as UpdateResults;
  await svc.processGuildUpdates({}, guild, latestResults);
  assert.equal(sentPayloads.length, 1, "doar 1 update pentru cs2");
});

function makeDiscountDeps(overrides: Record<string, unknown> = {}) {
  const updateOneCalls: Array<{ filter: unknown; update: unknown }> = [];
  const sentPayloads: SentPayload[] = [];
  const claims: string[] = [];
  const channel = {
    id: "channel-d",
    send: async (payload: SentPayload) => { sentPayloads.push(payload); return { id: "msg-1" }; }
  };
  const deps = {
    GuildModel: {
      find: () => ({ lean: async () => [] }),
      updateOne: async (filter: unknown, update: unknown) => {
        updateOneCalls.push({ filter, update });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    logger: () => undefined,
    runConcurrent: async (items: unknown[], _c: number, fn: (item: unknown) => Promise<void>) => { for (const it of items) await fn(it); },
    resolveOutboundChannel: async () => ({ channel, abort: false }),
    claimSeenDiscount: async (_gid: string, _cid: string, hash: string) => {
      claims.push(hash);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    rollbackSeenDiscount: async () => ({ matchedCount: 1, modifiedCount: 1 }),
    loadSeenDiscountHashes: async () => [],
    disableDiscountsForChannelError: async () => ({ matchedCount: 1, modifiedCount: 1 }),
    isPermanentDiscordError: () => false,
    transientErrorMessage: messageOf,
    normalizePendingDiscountArray: (arr: unknown) => Array.isArray(arr) ? arr : [],
    validatePendingDiscountSnapshot: () => true,
    normalizeCurrencyKey: (currency: unknown) => String(currency || "USD").toUpperCase(),
    dealPassesFilters: () => true,
    dealHash: (deal: TestDeal) => deal.id || "h",
    fetchDeals: async () => [{ id: "d1" }],
    getDealsCacheData: () => null,
    setDealsCache: () => undefined,
    enrichDealData: async (deal: TestDeal) => deal,
    buildDealEmbed: (deal: TestDeal) => ({ deal: deal.id }),
    sleepIfPositive: async () => undefined,
    DEFAULT_CURRENCY: "USD",
    DEALS_HISTORY_LIMIT: 300,
    PENDING_DISCOUNT_MAX_ATTEMPTS: 5,
    PENDING_DISCOUNT_GRACE_CYCLES: 3,
    PENDING_DISCOUNTS_LIMIT: 50,
    MAX_DEALS_PER_CYCLE: 8,
    DISCORD_SEND_DELAY_MS: 0,
    GUILD_PROCESS_CONCURRENCY: 1,
    ...overrides
  };
  return { deps: deps as unknown as DiscountDeps, updateOneCalls, sentPayloads, claims, channel };
}

test("DiscountService: trimite reduceri noi care nu sunt in seenDiscounts", async () => {
  const { deps, sentPayloads, claims } = makeDiscountDeps();
  const svc = createDiscountNotificationService(deps);
  const guild = {
    _id: "guild-1", discountsSubscribed: true, discountChannelId: "channel-d",
    seenDiscounts: [], pendingDiscounts: [], currency: "USD"
  } as DiscountGuild;
  const deals = [{ id: "d1", title: "Game A" }] as DiscountDeals;
  await svc.processGuildDiscounts({}, guild, deals);
  assert.equal(claims.length, 1, "trebuie sa claim-uim hash-ul nou");
  assert.equal(sentPayloads.length, 1);
});

test("DiscountService: hash deja in seenDiscounts NU se mai trimite", async () => {
  const { deps, sentPayloads, claims } = makeDiscountDeps();
  const svc = createDiscountNotificationService(deps);
  const guild = {
    _id: "guild-1", discountsSubscribed: true, discountChannelId: "channel-d",
    seenDiscounts: ["d1"], pendingDiscounts: [], currency: "USD"
  } as DiscountGuild;
  const deals = [{ id: "d1", title: "Already seen" }] as DiscountDeals;
  await svc.processGuildDiscounts({}, guild, deals);
  assert.equal(claims.length, 0);
  assert.equal(sentPayloads.length, 0);
});

test("DiscountService: reducerile sunt grupate intr-un singur mesaj cu ping rol o singura data", async () => {
  const { deps, sentPayloads } = makeDiscountDeps();
  const svc = createDiscountNotificationService(deps);
  const guild = {
    _id: "guild-1", discountsSubscribed: true, discountChannelId: "channel-d",
    seenDiscounts: [], pendingDiscounts: [], currency: "USD",
    discountRoleId: "role-99"
  } as DiscountGuild;
  const deals = [{ id: "d1" }, { id: "d2" }, { id: "d3" }] as DiscountDeals;
  await svc.processGuildDiscounts({}, guild, deals);
  assert.equal(sentPayloads.length, 1, "3 reduceri intr-un singur mesaj batch");
  assert.equal((sentPayloads[0].embeds as unknown[]).length, 3, "3 embed-uri in mesaj");
  assert.equal(sentPayloads[0].content, "<@&role-99>", "ping rol pe mesajul batch");
});

test("DiscountService: claim race (matchedCount=0) sare deal-ul fara enrich", async () => {
  let enrichCount = 0;
  const { deps, sentPayloads } = makeDiscountDeps({
    claimSeenDiscount: async () => ({ matchedCount: 0, modifiedCount: 0 }),
    enrichDealData: async (deal: TestDeal) => { enrichCount++; return deal; }
  });
  const svc = createDiscountNotificationService(deps);
  const guild = {
    _id: "guild-1", discountsSubscribed: true, discountChannelId: "channel-d",
    seenDiscounts: [], pendingDiscounts: [], currency: "USD"
  } as DiscountGuild;
  await svc.processGuildDiscounts({}, guild, [{ id: "d1" }] as DiscountDeals);
  assert.equal(sentPayloads.length, 0);
  assert.equal(enrichCount, 0, "claim ruleaza inainte de enrich; race-ul evita Steam calls");
});

test("DiscountService: dealPassesFilters=false sare deal-ul (filter-aware)", async () => {
  const { deps, sentPayloads } = makeDiscountDeps({
    dealPassesFilters: () => false
  });
  const svc = createDiscountNotificationService(deps);
  const guild = {
    _id: "guild-1", discountsSubscribed: true, discountChannelId: "channel-d",
    seenDiscounts: [], pendingDiscounts: [], currency: "USD"
  } as DiscountGuild;
  await svc.processGuildDiscounts({}, guild, [{ id: "d1" }] as DiscountDeals);
  assert.equal(sentPayloads.length, 0);
});

test("DiscountService: livrarea care epuizeaza retry-urile intra in dead-letter (capat $push)", async () => {
  const channel = { id: "channel-d", send: async () => { throw new Error("ECONNRESET"); } };
  const { deps, updateOneCalls } = makeDiscountDeps({
    resolveOutboundChannel: async () => ({ channel, abort: false }),
    PENDING_DISCOUNT_MAX_ATTEMPTS: 1
  });
  const svc = createDiscountNotificationService(deps);
  const guild = {
    _id: "guild-1", discountsSubscribed: true, discountChannelId: "channel-d",
    seenDiscounts: [], pendingDiscounts: [], currency: "USD"
  } as DiscountGuild;
  await svc.processGuildDiscounts({}, guild, [{ id: "d1", title: "Game A" }] as DiscountDeals);
  assert.equal(updateOneCalls.length, 1);
  const update = updateOneCalls[0].update as { $push?: { notificationDeadLetter?: { $each?: unknown[] } } };
  const entries = (update.$push?.notificationDeadLetter?.$each || []) as Array<{ kind: string; itemId: string; attempts: number }>;
  assert.equal(entries.length, 1, "un deal epuizat -> o intrare dead-letter");
  assert.deepEqual(
    { kind: entries[0].kind, itemId: entries[0].itemId, attempts: entries[0].attempts },
    { kind: "discount", itemId: "d1", attempts: 1 }
  );
});
