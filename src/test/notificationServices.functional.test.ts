import test from "node:test";
import assert from "node:assert/strict";
import { createUpdateNotificationService } from "../features/notifications/updateNotificationService";
import { createDiscountNotificationService } from "../features/notifications/discountNotificationService";

// V12: smoke tests pentru cele doua servicii extrase din notifications/index.ts.
// Verificam ca factory-urile construiesc handlers cu deps explicite si ca
// scenariile critice (gate-uri pe enabledGames, claim race, role ping pe prima
// trimitere) functioneaza.

function makeUpdateDeps(overrides: Record<string, any> = {}) {
  const updateOneCalls: Array<{ filter: unknown; update: unknown }> = [];
  const sentPayloads: Array<{ embeds?: unknown; content?: unknown }> = [];
  const claims: Array<{ guildId: string; gameKey: string; updateId: string }> = [];
  const rollbacks: Array<{ guildId: string; gameKey: string; updateId: string }> = [];
  const channel = {
    id: "channel-1",
    send: async (payload: any) => { sentPayloads.push(payload); return { id: "msg-1" }; }
  };
  const deps: any = {
    GuildModel: {
      find: () => ({ lean: async () => [] }),
      updateOne: async (filter: unknown, update: unknown) => {
        updateOneCalls.push({ filter, update });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    logger: () => undefined,
    runConcurrent: async (items: any[], _c: number, fn: any) => { for (const it of items) await fn(it); },
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
    transientErrorMessage: (e: any) => String(e?.message || e),
    normalizePendingUpdateArray: (arr: any) => Array.isArray(arr) ? arr : [],
    toEntries: (obj: any) => obj instanceof Map ? Array.from(obj.entries()) : Object.entries(obj || {}),
    rotateAfter: (keys: string[], lastKey: string | null) => {
      if (!lastKey) return keys;
      const idx = keys.indexOf(lastKey);
      if (idx === -1) return keys;
      return [...keys.slice(idx + 1), ...keys.slice(0, idx + 1)];
    },
    mapToObject: (m: Map<string, unknown>) => Object.fromEntries(m.entries()),
    getLatestForAllGames: async (games: any[]) => games.map((g: any) => ({ game: g, latest: { id: `u-${g.key}` } })),
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
  return { deps, updateOneCalls, sentPayloads, claims, rollbacks, channel };
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
    { enabledGames: [] } // sentinel: no filter → use all
  ];
  assert.deepEqual(svc.buildOptimizedGameList(games, guilds).map(g => g.key), ["cs2", "fortnite"]);
});

test("UpdateService: processGuildUpdates trimite update + ping rol pe prima trimitere", async () => {
  const { deps, sentPayloads, claims } = makeUpdateDeps();
  const svc = createUpdateNotificationService(deps);
  const guild: any = {
    _id: "guild-1",
    subscribed: true,
    notificationChannelId: "channel-1",
    notificationRoleId: "role-42",
    notificationMode: "detailed",
    seen: {},
    pendingUpdates: {},
    enabledGames: []
  };
  const latestResults: any = [
    { game: { key: "cs2", name: "CS2" }, latest: { id: "u-cs2", title: "patch" } }
  ];
  await svc.processGuildUpdates({}, guild, latestResults);
  assert.equal(sentPayloads.length, 1);
  assert.equal((sentPayloads[0] as any).content, "<@&role-42>", "rol ping pe prima trimitere");
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0], { guildId: "guild-1", gameKey: "cs2", updateId: "u-cs2" });
});

test("UpdateService: claim race (matchedCount=0) sare item-ul fara send sau rollback", async () => {
  const { deps, sentPayloads, rollbacks } = makeUpdateDeps({
    claimSeenUpdate: async () => ({ matchedCount: 0, modifiedCount: 0 })
  });
  const svc = createUpdateNotificationService(deps);
  const guild: any = {
    _id: "guild-1", subscribed: true, notificationChannelId: "channel-1",
    seen: {}, pendingUpdates: {}, enabledGames: []
  };
  const latestResults: any = [{ game: { key: "cs2", name: "CS2" }, latest: { id: "u-1" } }];
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
  const guild: any = {
    _id: "guild-1", subscribed: true, notificationChannelId: "channel-1",
    seen: {}, pendingUpdates: {}, enabledGames: []
  };
  const latestResults: any = [{ game: { key: "cs2", name: "CS2" }, latest: { id: "u-1" } }];
  await svc.processGuildUpdates({}, guild, latestResults);
  assert.equal(sendCallCount, 1);
  assert.equal(rollbacks.length, 1, "rollback obligatoriu pe transient fail");
});

test("UpdateService: enabledGames filter sare jocurile ne-active", async () => {
  const { deps, sentPayloads } = makeUpdateDeps();
  const svc = createUpdateNotificationService(deps);
  const guild: any = {
    _id: "guild-1", subscribed: true, notificationChannelId: "channel-1",
    seen: {}, pendingUpdates: {},
    enabledGames: ["cs2"] // doar cs2 e activ
  };
  const latestResults: any = [
    { game: { key: "cs2", name: "CS2" }, latest: { id: "u-cs2" } },
    { game: { key: "fortnite", name: "Fortnite" }, latest: { id: "u-fn" } }
  ];
  await svc.processGuildUpdates({}, guild, latestResults);
  assert.equal(sentPayloads.length, 1, "doar 1 update pentru cs2");
});

// ===== Discount service =====

function makeDiscountDeps(overrides: Record<string, any> = {}) {
  const updateOneCalls: Array<{ filter: unknown; update: unknown }> = [];
  const sentPayloads: any[] = [];
  const claims: string[] = [];
  const channel = {
    id: "channel-d",
    send: async (payload: any) => { sentPayloads.push(payload); return { id: "msg-1" }; }
  };
  const deps: any = {
    GuildModel: {
      find: () => ({ lean: async () => [] }),
      updateOne: async (filter: unknown, update: unknown) => {
        updateOneCalls.push({ filter, update });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    logger: () => undefined,
    runConcurrent: async (items: any[], _c: number, fn: any) => { for (const it of items) await fn(it); },
    resolveOutboundChannel: async () => ({ channel, abort: false }),
    claimSeenDiscount: async (_gid: string, _cid: string, hash: string) => {
      claims.push(hash);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    rollbackSeenDiscount: async () => ({ matchedCount: 1, modifiedCount: 1 }),
    disableDiscountsForChannelError: async () => ({ matchedCount: 1, modifiedCount: 1 }),
    isPermanentDiscordError: () => false,
    transientErrorMessage: (e: any) => String(e?.message || e),
    normalizePendingDiscountArray: (arr: any) => Array.isArray(arr) ? arr : [],
    validatePendingDiscountSnapshot: () => true,
    normalizeCurrencyKey: (c: any) => String(c || "USD").toUpperCase(),
    dealPassesFilters: () => true,
    dealHash: (deal: any) => deal.id || "h",
    fetchDeals: async () => [{ id: "d1" }],
    getDealsCacheData: () => null,
    setDealsCache: () => undefined,
    enrichDealData: async (d: any) => d,
    buildDealEmbed: (d: any) => ({ deal: d.id }),
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
  return { deps, updateOneCalls, sentPayloads, claims, channel };
}

test("DiscountService: trimite reduceri noi care nu sunt in seenDiscounts", async () => {
  const { deps, sentPayloads, claims } = makeDiscountDeps();
  const svc = createDiscountNotificationService(deps);
  const guild: any = {
    _id: "guild-1", discountsSubscribed: true, discountChannelId: "channel-d",
    seenDiscounts: [], pendingDiscounts: [], currency: "USD"
  };
  const deals: any = [{ id: "d1", title: "Game A" }];
  await svc.processGuildDiscounts({}, guild, deals);
  assert.equal(claims.length, 1, "trebuie sa claim-uim hash-ul nou");
  assert.equal(sentPayloads.length, 1);
});

test("DiscountService: hash deja in seenDiscounts NU se mai trimite", async () => {
  const { deps, sentPayloads, claims } = makeDiscountDeps();
  const svc = createDiscountNotificationService(deps);
  const guild: any = {
    _id: "guild-1", discountsSubscribed: true, discountChannelId: "channel-d",
    seenDiscounts: ["d1"], pendingDiscounts: [], currency: "USD"
  };
  const deals: any = [{ id: "d1", title: "Already seen" }];
  await svc.processGuildDiscounts({}, guild, deals);
  assert.equal(claims.length, 0);
  assert.equal(sentPayloads.length, 0);
});

test("DiscountService: ping rol discount doar pe prima trimitere", async () => {
  const { deps, sentPayloads } = makeDiscountDeps();
  const svc = createDiscountNotificationService(deps);
  const guild: any = {
    _id: "guild-1", discountsSubscribed: true, discountChannelId: "channel-d",
    seenDiscounts: [], pendingDiscounts: [], currency: "USD",
    discountRoleId: "role-99"
  };
  const deals: any = [{ id: "d1" }, { id: "d2" }, { id: "d3" }];
  await svc.processGuildDiscounts({}, guild, deals);
  assert.equal(sentPayloads.length, 3);
  assert.equal((sentPayloads[0] as any).content, "<@&role-99>");
  assert.equal((sentPayloads[1] as any).content, undefined, "fara ping pe a 2-a");
  assert.equal((sentPayloads[2] as any).content, undefined);
});

test("DiscountService: claim race (matchedCount=0) sare deal-ul fara enrich", async () => {
  let enrichCount = 0;
  const { deps, sentPayloads } = makeDiscountDeps({
    claimSeenDiscount: async () => ({ matchedCount: 0, modifiedCount: 0 }),
    enrichDealData: async (d: any) => { enrichCount++; return d; }
  });
  const svc = createDiscountNotificationService(deps);
  const guild: any = {
    _id: "guild-1", discountsSubscribed: true, discountChannelId: "channel-d",
    seenDiscounts: [], pendingDiscounts: [], currency: "USD"
  };
  await svc.processGuildDiscounts({}, guild, [{ id: "d1" }] as any);
  assert.equal(sentPayloads.length, 0);
  assert.equal(enrichCount, 0, "V12 — claim ruleaza inainte de enrich; race-ul evita Steam calls");
});

test("DiscountService: dealPassesFilters=false sare deal-ul (filter-aware)", async () => {
  const { deps, sentPayloads } = makeDiscountDeps({
    dealPassesFilters: () => false
  });
  const svc = createDiscountNotificationService(deps);
  const guild: any = {
    _id: "guild-1", discountsSubscribed: true, discountChannelId: "channel-d",
    seenDiscounts: [], pendingDiscounts: [], currency: "USD"
  };
  await svc.processGuildDiscounts({}, guild, [{ id: "d1" }] as any);
  assert.equal(sentPayloads.length, 0);
});
