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
const noopDiscordClient = { channels: { fetch: async () => null } };
type SentMeta = { historyEntries?: Array<{ kind: string; gameKey?: string; title?: string; link?: string }> } | undefined;

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
  const sentMetas: SentMeta[] = [];
  const channel = {
    id: "channel-1",
    send: async (payload: SentPayload, meta?: SentMeta) => { sentPayloads.push(payload); sentMetas.push(meta); return { id: "msg-1" }; }
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
    runConcurrent: async (items: unknown[], _c: number, fn: (item: unknown) => Promise<void>) => {
      let processed = 0;
      const errors: Array<{ error: unknown }> = [];
      for (const it of items) {
        try { await fn(it); processed++; } catch (error) { errors.push({ error }); }
      }
      return { processed, errors };
    },
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
    seedSeenUpdates: async () => undefined,
    setSeenHashVersion: async () => ({ matchedCount: 1, modifiedCount: 1 }),
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
  return { deps: deps as unknown as UpdateDeps, updateOneCalls, sentPayloads, sentMetas, claims, rollbacks, channel };
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
  const guild = { _id: "g1", subscribed: true, notificationChannelId: "channel-1", seenHashVersionUpdates: 2, seen: {}, pendingUpdates: {}, enabledGames: [] };
  const { deps } = makeUpdateDeps({
    GuildModel: { find: () => ({ lean: async () => [guild] }), updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }) },
    setUpdatesCache: () => { cacheWrites++; }
  });
  const svc = createUpdateNotificationService(deps);
  await svc.checkForUpdates(noopDiscordClient, [{ key: "cs2" }, { key: "fortnite" }]);
  assert.equal(cacheWrites, 1, "lista completa → cache scris exact o data");
});

test("UpdateService: checkForUpdates NU scrie cache cand lista e filtrata (subset)", async () => {
  let cacheWrites = 0;
  const guild = { _id: "g1", subscribed: true, notificationChannelId: "channel-1", seenHashVersionUpdates: 2, seen: {}, pendingUpdates: {}, enabledGames: ["cs2"] };
  const { deps } = makeUpdateDeps({
    GuildModel: { find: () => ({ lean: async () => [guild] }), updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }) },
    setUpdatesCache: () => { cacheWrites++; }
  });
  const svc = createUpdateNotificationService(deps);
  await svc.checkForUpdates(noopDiscordClient, [{ key: "cs2" }, { key: "fortnite" }]);
  assert.equal(cacheWrites, 0, "subset filtrat → cache global nu trebuie scris (ar fi partial)");
});

test("UpdateService: processGuildUpdates trimite update + ping rol pe prima trimitere", async () => {
  const { deps, sentPayloads, claims, updateOneCalls } = makeUpdateDeps();
  const svc = createUpdateNotificationService(deps);
  const guild = {
    _id: "guild-1",
    subscribed: true,
    notificationChannelId: "channel-1",
    seenHashVersionUpdates: 2,
    notificationRoleId: "role-42",
    notificationMode: "detailed",
    seen: {},
    pendingUpdates: {},
    enabledGames: []
  } as UpdateGuild;
  const latestResults = [
    { game: { key: "cs2", name: "CS2" }, latest: { id: "u-cs2", title: "patch" } }
  ] as UpdateResults;
  await svc.processGuildUpdates(noopDiscordClient, guild, latestResults);
  assert.equal(sentPayloads.length, 1);
  assert.equal(sentPayloads[0].content, "<@&role-42>", "rol ping pe prima trimitere");
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0], { guildId: "guild-1", gameKey: "cs2", updateId: "u-cs2" });
  const persist = updateOneCalls.find(c => {
    const f = c.filter as { _id?: unknown; subscribed?: unknown };
    return f && f._id === "guild-1" && f.subscribed === true;
  });
  assert.ok(persist, "persista cu filtrul QueryFilter (mongoose 9): { _id, subscribed:true, notificationChannelId }");
  assert.equal((persist!.filter as { notificationChannelId?: unknown }).notificationChannelId, "channel-1", "filtrul include canalul (guard impotriva scrierii pe guild gresit)");
});

test("UpdateService: mai multe update-uri sunt grupate intr-un singur mesaj cu mai multe embed-uri", async () => {
  const { deps, sentPayloads, claims } = makeUpdateDeps();
  const svc = createUpdateNotificationService(deps);
  const guild = {
    _id: "guild-1", subscribed: true, notificationChannelId: "channel-1", seenHashVersionUpdates: 2,
    notificationRoleId: "role-7", seen: {}, pendingUpdates: {}, enabledGames: []
  } as UpdateGuild;
  const latestResults = [
    { game: { key: "cs2", name: "CS2" }, latest: { id: "u-cs2", title: "a" } },
    { game: { key: "fortnite", name: "Fortnite" }, latest: { id: "u-fn", title: "b" } },
    { game: { key: "dota2", name: "Dota2" }, latest: { id: "u-dota", title: "c" } }
  ] as UpdateResults;
  await svc.processGuildUpdates(noopDiscordClient, guild, latestResults);
  assert.equal(sentPayloads.length, 1, "3 update-uri intr-un singur mesaj batch");
  assert.equal((sentPayloads[0].embeds as unknown[]).length, 3, "3 embed-uri in mesaj");
  assert.equal(sentPayloads[0].content, "<@&role-7>", "ping rol pe mesajul batch");
  assert.equal(claims.length, 3, "fiecare update este claim-uit inainte de trimitere");
});

test("UpdateService: send-ul transmite meta.historyEntries pentru scrierea istoricului la livrare", async () => {
  const { deps, sentMetas } = makeUpdateDeps();
  const svc = createUpdateNotificationService(deps);
  const guild = {
    _id: "guild-1", subscribed: true, notificationChannelId: "channel-1", seenHashVersionUpdates: 2,
    seen: {}, pendingUpdates: {}, enabledGames: []
  } as UpdateGuild;
  const latestResults = [
    { game: { key: "cs2", name: "CS2" }, latest: { id: "u-cs2", title: "Patch 1.5", link: "https://example.com/cs2" } }
  ] as UpdateResults;
  await svc.processGuildUpdates(noopDiscordClient, guild, latestResults);
  assert.equal(sentMetas.length, 1);
  assert.deepEqual(sentMetas[0]?.historyEntries, [
    { kind: "update", gameKey: "cs2", title: "Patch 1.5", link: "https://example.com/cs2" }
  ], "serviciul nu mai scrie istoric direct; trimite intrarile prin meta catre canal");
});

test("UpdateService: claim race (matchedCount=0) sare item-ul fara send sau rollback", async () => {
  const { deps, sentPayloads, rollbacks } = makeUpdateDeps({
    claimSeenUpdate: async () => ({ matchedCount: 0, modifiedCount: 0 })
  });
  const svc = createUpdateNotificationService(deps);
  const guild = {
    _id: "guild-1", subscribed: true, notificationChannelId: "channel-1", seenHashVersionUpdates: 2,
    seen: {}, pendingUpdates: {}, enabledGames: []
  } as UpdateGuild;
  const latestResults = [{ game: { key: "cs2", name: "CS2" }, latest: { id: "u-1" } }] as UpdateResults;
  await svc.processGuildUpdates(noopDiscordClient, guild, latestResults);
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
    _id: "guild-1", subscribed: true, notificationChannelId: "channel-1", seenHashVersionUpdates: 2,
    seen: {}, pendingUpdates: {}, enabledGames: []
  } as UpdateGuild;
  const latestResults = [{ game: { key: "cs2", name: "CS2" }, latest: { id: "u-1" } }] as UpdateResults;
  await svc.processGuildUpdates(noopDiscordClient, guild, latestResults);
  assert.equal(sendCallCount, 1);
  assert.equal(rollbacks.length, 1, "rollback obligatoriu pe transient fail");
});

test("UpdateService: buildUpdateEmbed care arunca da claim-ul inapoi si dead-letter-uieste dupa epuizarea incercarilor", async () => {
  let sendCalls = 0;
  const channel = { id: "channel-1", send: async () => { sendCalls++; return {}; } };
  const { deps, rollbacks, updateOneCalls } = makeUpdateDeps({
    resolveOutboundChannel: async () => ({ channel, abort: false }),
    buildUpdateEmbed: () => { throw new Error("embed corupt"); },
    PENDING_UPDATE_MAX_ATTEMPTS: 2
  });
  const svc = createUpdateNotificationService(deps);
  const guild = {
    _id: "guild-1", subscribed: true, notificationChannelId: "channel-1", seenHashVersionUpdates: 2,
    seen: {}, pendingUpdates: {}, enabledGames: []
  } as UpdateGuild;
  const latestResults = [{ game: { key: "cs2", name: "CS2" }, latest: { id: "u-1", title: "patch" } }] as UpdateResults;
  await svc.processGuildUpdates(noopDiscordClient, guild, latestResults);
  assert.equal(sendCalls, 0, "nimic trimis cand embed-ul crapa");
  assert.ok(rollbacks.length >= 1, "claim-ul e dat inapoi (regresie: update-ul ramanea marcat seen fara sa fie trimis vreodata)");
  const update = updateOneCalls[0].update as { $push?: { notificationDeadLetter?: { $each?: unknown[] } } };
  const entries = (update.$push?.notificationDeadLetter?.$each || []) as Array<{ itemId: string; reason: string }>;
  assert.equal(entries.length, 1, "dupa epuizarea incercarilor itemul ajunge in dead-letter, nu se pierde tacut");
  assert.equal(entries[0].itemId, "u-1");
  assert.match(entries[0].reason, /embed corupt/);
});

test("UpdateService: livrarea care epuizeaza retry-urile intra in dead-letter (capat $push)", async () => {
  const channel = { id: "channel-1", send: async () => { throw new Error("ECONNRESET"); } };
  const { deps, updateOneCalls } = makeUpdateDeps({
    resolveOutboundChannel: async () => ({ channel, abort: false }),
    PENDING_UPDATE_MAX_ATTEMPTS: 1
  });
  const svc = createUpdateNotificationService(deps);
  const guild = {
    _id: "guild-1", subscribed: true, notificationChannelId: "channel-1", seenHashVersionUpdates: 2,
    seen: {}, pendingUpdates: {}, enabledGames: []
  } as UpdateGuild;
  const latestResults = [{ game: { key: "cs2", name: "CS2" }, latest: { id: "u-1", title: "patch" } }] as UpdateResults;
  await svc.processGuildUpdates(noopDiscordClient, guild, latestResults);
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
    _id: "guild-1", subscribed: true, notificationChannelId: "channel-1", seenHashVersionUpdates: 2,
    seen: {}, pendingUpdates: {}, enabledGames: []
  } as UpdateGuild;
  const latestResults = [{ game: { key: "cs2", name: "CS2" }, latest: { id: "u-1" } }] as UpdateResults;
  await svc.processGuildUpdates(noopDiscordClient, guild, latestResults);
  const update = updateOneCalls[0].update as { $push?: unknown };
  assert.equal(update.$push, undefined, "cat timp se mai poate reincerca, nu scriem dead-letter");
});

test("UpdateService: enabledGames filter sare jocurile ne-active", async () => {
  const { deps, sentPayloads } = makeUpdateDeps();
  const svc = createUpdateNotificationService(deps);
  const guild = {
    _id: "guild-1", subscribed: true, notificationChannelId: "channel-1", seenHashVersionUpdates: 2,
    seen: {}, pendingUpdates: {},
    enabledGames: ["cs2"]
  } as UpdateGuild;
  const latestResults = [
    { game: { key: "cs2", name: "CS2" }, latest: { id: "u-cs2" } },
    { game: { key: "fortnite", name: "Fortnite" }, latest: { id: "u-fn" } }
  ] as UpdateResults;
  await svc.processGuildUpdates(noopDiscordClient, guild, latestResults);
  assert.equal(sentPayloads.length, 1, "doar 1 update pentru cs2");
});

function makeDiscountDeps(overrides: Record<string, unknown> = {}) {
  const updateOneCalls: Array<{ filter: unknown; update: unknown }> = [];
  const sentPayloads: SentPayload[] = [];
  const claims: string[] = [];
  const sentMetas: SentMeta[] = [];
  const channel = {
    id: "channel-d",
    send: async (payload: SentPayload, meta?: SentMeta) => { sentPayloads.push(payload); sentMetas.push(meta); return { id: "msg-1" }; }
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
    runConcurrent: async (items: unknown[], _c: number, fn: (item: unknown) => Promise<void>) => {
      let processed = 0;
      const errors: Array<{ error: unknown }> = [];
      for (const it of items) {
        try { await fn(it); processed++; } catch (error) { errors.push({ error }); }
      }
      return { processed, errors };
    },
    resolveOutboundChannel: async () => ({ channel, abort: false }),
    claimSeenDiscount: async (_gid: string, _cid: string, hash: string) => {
      claims.push(hash);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    rollbackSeenDiscount: async () => ({ matchedCount: 1, modifiedCount: 1 }),
    loadSeenDiscountHashes: async () => [],
    seedSeenDiscounts: async () => undefined,
    setSeenHashVersion: async () => ({ matchedCount: 1, modifiedCount: 1 }),
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
  return { deps: deps as unknown as DiscountDeps, updateOneCalls, sentPayloads, sentMetas, claims, channel };
}

test("DiscountService: trimite reduceri noi care nu sunt in seenDiscounts", async () => {
  const { deps, sentPayloads, claims } = makeDiscountDeps();
  const svc = createDiscountNotificationService(deps);
  const guild = {
    _id: "guild-1", discountsSubscribed: true, discountChannelId: "channel-d", seenHashVersionDiscounts: 2,
    seenDiscounts: [], pendingDiscounts: [], currency: "USD"
  } as DiscountGuild;
  const deals = [{ id: "d1", title: "Game A" }] as DiscountDeals;
  await svc.processGuildDiscounts(noopDiscordClient, guild, deals);
  assert.equal(claims.length, 1, "trebuie sa claim-uim hash-ul nou");
  assert.equal(sentPayloads.length, 1);
});

test("DiscountService: send-ul transmite meta.historyEntries cu titlul si link-ul reducerii", async () => {
  const { deps, sentMetas } = makeDiscountDeps();
  const svc = createDiscountNotificationService(deps);
  const guild = {
    _id: "guild-1", discountsSubscribed: true, discountChannelId: "channel-d", seenHashVersionDiscounts: 2,
    seenDiscounts: [], pendingDiscounts: [], currency: "USD"
  } as DiscountGuild;
  const deals = [{ id: "d1", title: "Game A", url: "https://example.com/deal-a" }] as DiscountDeals;
  await svc.processGuildDiscounts(noopDiscordClient, guild, deals);
  assert.equal(sentMetas.length, 1);
  assert.deepEqual(sentMetas[0]?.historyEntries, [
    { kind: "discount", title: "Game A", link: "https://example.com/deal-a" }
  ], "serviciul nu mai scrie istoric direct; trimite intrarile prin meta catre canal");
});

test("DiscountService: hash deja vazut (in colectia seen) NU se mai trimite", async () => {
  const { deps, sentPayloads, claims } = makeDiscountDeps({ loadSeenDiscountHashes: async () => ["d1"] });
  const svc = createDiscountNotificationService(deps);
  const guild = {
    _id: "guild-1", discountsSubscribed: true, discountChannelId: "channel-d", seenHashVersionDiscounts: 2,
    pendingDiscounts: [], currency: "USD"
  } as DiscountGuild;
  const deals = [{ id: "d1", title: "Already seen" }] as DiscountDeals;
  await svc.processGuildDiscounts(noopDiscordClient, guild, deals);
  assert.equal(claims.length, 0);
  assert.equal(sentPayloads.length, 0);
});

test("DiscountService: cere doar candidatii ciclului la loadSeenDiscountHashes (query marginit, nu tot istoricul)", async () => {
  const candidateCalls: Array<string[] | undefined> = [];
  const { deps } = makeDiscountDeps({
    loadSeenDiscountHashes: async (_gid: string, candidates?: string[]) => { candidateCalls.push(candidates); return []; }
  });
  const svc = createDiscountNotificationService(deps);
  const guild = {
    _id: "guild-1", discountsSubscribed: true, discountChannelId: "channel-d", seenHashVersionDiscounts: 2,
    pendingDiscounts: [{ hash: "p-old", snapshot: { id: "p-old", title: "Pending" }, lastSeenAt: new Date(), attempts: 0 }], currency: "USD"
  } as DiscountGuild;
  await svc.processGuildDiscounts(noopDiscordClient, guild, [{ id: "d1", title: "Game A" }] as DiscountDeals);
  assert.equal(candidateCalls.length, 1);
  assert.ok(Array.isArray(candidateCalls[0]), "serviciul paseaza lista de candidati, nu mai cere tot istoricul guild-ului");
  assert.ok((candidateCalls[0] as string[]).includes("d1"), "include hash-urile ofertelor curente");
  assert.ok((candidateCalls[0] as string[]).includes("p-old"), "include hash-urile pending-urilor vechi");
});

test("DiscountService: reducerile sunt grupate intr-un singur mesaj cu ping rol o singura data", async () => {
  const { deps, sentPayloads } = makeDiscountDeps();
  const svc = createDiscountNotificationService(deps);
  const guild = {
    _id: "guild-1", discountsSubscribed: true, discountChannelId: "channel-d", seenHashVersionDiscounts: 2,
    seenDiscounts: [], pendingDiscounts: [], currency: "USD",
    discountRoleId: "role-99"
  } as DiscountGuild;
  const deals = [{ id: "d1" }, { id: "d2" }, { id: "d3" }] as DiscountDeals;
  await svc.processGuildDiscounts(noopDiscordClient, guild, deals);
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
    _id: "guild-1", discountsSubscribed: true, discountChannelId: "channel-d", seenHashVersionDiscounts: 2,
    seenDiscounts: [], pendingDiscounts: [], currency: "USD"
  } as DiscountGuild;
  await svc.processGuildDiscounts(noopDiscordClient, guild, [{ id: "d1" }] as DiscountDeals);
  assert.equal(sentPayloads.length, 0);
  assert.equal(enrichCount, 0, "claim ruleaza inainte de enrich; race-ul evita Steam calls");
});

test("DiscountService: dealPassesFilters=false sare deal-ul (filter-aware)", async () => {
  const { deps, sentPayloads } = makeDiscountDeps({
    dealPassesFilters: () => false
  });
  const svc = createDiscountNotificationService(deps);
  const guild = {
    _id: "guild-1", discountsSubscribed: true, discountChannelId: "channel-d", seenHashVersionDiscounts: 2,
    seenDiscounts: [], pendingDiscounts: [], currency: "USD"
  } as DiscountGuild;
  await svc.processGuildDiscounts(noopDiscordClient, guild, [{ id: "d1" }] as DiscountDeals);
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
    _id: "guild-1", discountsSubscribed: true, discountChannelId: "channel-d", seenHashVersionDiscounts: 2,
    seenDiscounts: [], pendingDiscounts: [], currency: "USD"
  } as DiscountGuild;
  await svc.processGuildDiscounts(noopDiscordClient, guild, [{ id: "d1", title: "Game A" }] as DiscountDeals);
  assert.equal(updateOneCalls.length, 1);
  const update = updateOneCalls[0].update as { $push?: { notificationDeadLetter?: { $each?: unknown[] } } };
  const entries = (update.$push?.notificationDeadLetter?.$each || []) as Array<{ kind: string; itemId: string; attempts: number }>;
  assert.equal(entries.length, 1, "un deal epuizat -> o intrare dead-letter");
  assert.deepEqual(
    { kind: entries[0].kind, itemId: entries[0].itemId, attempts: entries[0].attempts },
    { kind: "discount", itemId: "d1", attempts: 1 }
  );
});

test("DiscountService: re-baseline la hashVersion invechit seed-uieste hash-urile curente FARA notificari", async () => {
  const seeded: string[][] = [];
  const versions: Array<{ field: string; version: number }> = [];
  const { deps, sentPayloads } = makeDiscountDeps({
    seedSeenDiscounts: async (_g: string, hashes: string[]) => { seeded.push(hashes); },
    setSeenHashVersion: async (_g: string, field: "seenHashVersionUpdates" | "seenHashVersionDiscounts", version: number) => {
      versions.push({ field, version }); return { matchedCount: 1, modifiedCount: 1 };
    }
  });
  const svc = createDiscountNotificationService(deps);
  const guild = {
    _id: "guild-stale", discountsSubscribed: true, discountChannelId: "channel-d",
    pendingDiscounts: [], currency: "USD"
  } as DiscountGuild;
  await svc.processGuildDiscounts(noopDiscordClient, guild, [{ id: "d1", title: "A" }, { id: "d2", title: "B" }] as DiscountDeals);
  assert.equal(sentPayloads.length, 0, "re-baseline nu trimite notificari in ciclul curent");
  assert.deepEqual(seeded, [["d1", "d2"]], "seed-uieste toate hash-urile curente");
  assert.deepEqual(versions, [{ field: "seenHashVersionDiscounts", version: 2 }], "marcheaza versiunea curenta de hash");
});

test("UpdateService: re-baseline la hashVersion invechit seed-uieste update-urile curente FARA notificari", async () => {
  const seeded: Array<Array<{ gameKey: string; updateId: string }>> = [];
  const versions: Array<{ field: string; version: number }> = [];
  const { deps, sentPayloads, claims } = makeUpdateDeps({
    seedSeenUpdates: async (_g: string, entries: Array<{ gameKey: string; updateId: string }>) => { seeded.push(entries); },
    setSeenHashVersion: async (_g: string, field: "seenHashVersionUpdates" | "seenHashVersionDiscounts", version: number) => {
      versions.push({ field, version }); return { matchedCount: 1, modifiedCount: 1 };
    }
  });
  const svc = createUpdateNotificationService(deps);
  const guild = {
    _id: "guild-stale", subscribed: true, notificationChannelId: "channel-1",
    pendingUpdates: {}
  } as UpdateGuild;
  const latestResults = [
    { game: { key: "cs2" }, latest: { id: "u-cs2" } },
    { game: { key: "dota2" }, latest: { id: "u-dota2" } }
  ] as UpdateResults;
  await svc.processGuildUpdates(noopDiscordClient, guild, latestResults);
  assert.equal(sentPayloads.length, 0, "re-baseline nu trimite notificari");
  assert.equal(claims.length, 0, "nu revendica nimic in ciclul de re-baseline");
  assert.deepEqual(seeded, [[{ gameKey: "cs2", updateId: "u-cs2" }, { gameKey: "dota2", updateId: "u-dota2" }]]);
  assert.deepEqual(versions, [{ field: "seenHashVersionUpdates", version: 2 }]);
});

test("UpdateService: fetch esuat FARA snapshot proaspat -> checkForUpdates arunca (cron vede ciclu esuat, review #1)", async () => {
  const guild = { _id: "g1", subscribed: true, notificationChannelId: "channel-1", seenHashVersionUpdates: 2, pendingUpdates: {}, enabledGames: [] };
  const { deps } = makeUpdateDeps({
    GuildModel: { find: () => ({ lean: async () => [guild] }), updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }) },
    getLatestForAllGames: async () => { throw new Error("ECONNRESET total"); }
  });
  const svc = createUpdateNotificationService(deps);
  await assert.rejects(
    () => svc.checkForUpdates(noopDiscordClient, [{ key: "cs2" }]),
    /snapshot de rezerva proaspat.*ECONNRESET total/,
    "regresie: functia facea return dupa logger.ERROR -> promisiunea se rezolva si cron-ul marca ciclul drept sanatos"
  );
});

test("UpdateService: fetch esuat CU snapshot proaspat -> checkForUpdates NU arunca (fallback functional)", async () => {
  const guild = { _id: "g1", subscribed: true, notificationChannelId: "channel-1", seenHashVersionUpdates: 2, pendingUpdates: {}, enabledGames: [] };
  const { deps } = makeUpdateDeps({
    GuildModel: { find: () => ({ lean: async () => [guild] }), updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }) },
    getLatestForAllGames: async () => { throw new Error("ECONNRESET total"); },
    loadFetchSnapshot: async () => ({ payload: [{ game: { key: "cs2" }, latest: { id: "u-cs2" } }], fetchedAt: new Date() })
  });
  const svc = createUpdateNotificationService(deps);
  await svc.checkForUpdates(noopDiscordClient, [{ key: "cs2" }]);
});

test("UpdateService: TOATE guild-urile esueaza la procesare -> checkForUpdates arunca", async () => {
  const guild = { _id: "g1", subscribed: true, notificationChannelId: "channel-1", seenHashVersionUpdates: 2, pendingUpdates: {}, enabledGames: [] };
  const { deps } = makeUpdateDeps({
    GuildModel: { find: () => ({ lean: async () => [guild] }), updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }) },
    resolveOutboundChannel: async () => { throw new Error("Discord indisponibil"); }
  });
  const svc = createUpdateNotificationService(deps);
  await assert.rejects(
    () => svc.checkForUpdates(noopDiscordClient, [{ key: "cs2" }]),
    /toate cele 1 guild-uri abonate.*Discord indisponibil/
  );
});

test("UpdateService: esec PARTIAL pe guild-uri -> checkForUpdates NU arunca (degradare logata, nu fatala)", async () => {
  const guilds = [
    { _id: "g-bad", subscribed: true, notificationChannelId: "channel-1", seenHashVersionUpdates: 2, pendingUpdates: {}, enabledGames: [] },
    { _id: "g-ok", subscribed: true, notificationChannelId: "channel-1", seenHashVersionUpdates: 2, pendingUpdates: {}, enabledGames: [] }
  ];
  const { deps, channel } = makeUpdateDeps({
    GuildModel: { find: () => ({ lean: async () => guilds }), updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }) },
    resolveOutboundChannel: async ({ guild }: { guild: { _id?: string } }) => {
      if (guild._id === "g-bad") throw new Error("canal mort");
      return { channel, abort: false };
    }
  });
  const svc = createUpdateNotificationService(deps);
  await svc.checkForUpdates(noopDiscordClient, [{ key: "cs2" }]);
});

test("DiscountService: fetchDeals esueaza pentru toate monedele fara snapshot -> checkForDiscounts arunca (review #2)", async () => {
  const guild = { _id: "g1", discountsSubscribed: true, discountChannelId: "channel-d", seenHashVersionDiscounts: 2, pendingDiscounts: [], currency: "USD" };
  const { deps } = makeDiscountDeps({
    GuildModel: { find: () => ({ lean: async () => [guild] }), updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }) },
    fetchDeals: async () => { throw new Error("Epic+Steam cazute"); }
  });
  const svc = createDiscountNotificationService(deps);
  await assert.rejects(
    () => svc.checkForDiscounts(noopDiscordClient),
    /toate cele 1 guild-uri abonate.*Epic\+Steam cazute/,
    "regresie: runConcurrent inghitea erorile per-guild in { errors } iar caller-ul le ignora -> cron sanatos cu reduceri complet cazute"
  );
});

test("DiscountService: esec PARTIAL (o moneda din doua) -> checkForDiscounts NU arunca", async () => {
  const guilds = [
    { _id: "g-usd", discountsSubscribed: true, discountChannelId: "channel-d", seenHashVersionDiscounts: 2, pendingDiscounts: [], currency: "USD" },
    { _id: "g-eur", discountsSubscribed: true, discountChannelId: "channel-d", seenHashVersionDiscounts: 2, pendingDiscounts: [], currency: "EUR" }
  ];
  const { deps } = makeDiscountDeps({
    GuildModel: { find: () => ({ lean: async () => guilds }), updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }) },
    fetchDeals: async ({ currency }: { currency: string }) => {
      if (currency === "EUR") throw new Error("EUR indisponibil");
      return [{ id: "d1", title: "Game A" }];
    }
  });
  const svc = createDiscountNotificationService(deps);
  await svc.checkForDiscounts(noopDiscordClient);
});

function makeAllNullDeps(results: Array<{ key: string; error?: string; latest?: { id: string } | null }>, extra: Record<string, unknown> = {}) {
  const persistCalls: string[] = [];
  const guild = { _id: "g1", subscribed: true, notificationChannelId: "channel-1", seenHashVersionUpdates: 2, pendingUpdates: {}, enabledGames: [] };
  const { deps } = makeUpdateDeps({
    GuildModel: { find: () => ({ lean: async () => [guild] }), updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }) },
    getLatestForAllGames: async () => results.map(entry => ({ game: { key: entry.key, name: entry.key }, latest: entry.latest ?? null, error: entry.error })),
    persistFetchSnapshot: async (id: string) => { persistCalls.push(id); },
    ...extra
  });
  return { deps, persistCalls };
}

test("UpdateService: toate jocurile cu latest null + erori reale -> ciclu esuat, snapshot NEpersistat (review #1)", async () => {
  const { deps, persistCalls } = makeAllNullDeps([
    { key: "cs2", error: "ECONNRESET" },
    { key: "dota2", error: "schema drift" }
  ]);
  const svc = createUpdateNotificationService(deps);
  await assert.rejects(
    () => svc.checkForUpdates(noopDiscordClient, [{ key: "cs2" }, { key: "dota2" }]),
    /latest: null.*2 cu erori reale.*snapshot de rezerva proaspat|snapshot de rezerva proaspat.*latest: null/,
    "regresie: erorile per-joc deveneau { latest: null, error } iar serviciul trata rezultatul ca fetch reusit"
  );
  assert.deepEqual(persistCalls, [], "snapshot-ul all-null NU se persista (ar deveni fallback fals-proaspat)");
});

test("UpdateService: toate null + erori reale, dar CU snapshot proaspat -> dispatch din snapshot, fara persist", async () => {
  const { deps, persistCalls } = makeAllNullDeps([{ key: "cs2", error: "ECONNRESET" }], {
    loadFetchSnapshot: async () => ({ payload: [{ game: { key: "cs2" }, latest: { id: "u-cs2" } }], fetchedAt: new Date() })
  });
  const svc = createUpdateNotificationService(deps);
  await svc.checkForUpdates(noopDiscordClient, [{ key: "cs2" }]);
  assert.deepEqual(persistCalls, [], "nici pe calea de fallback nu se persista rezultatul all-null");
});

test("UpdateService: toate null doar din abort -> NU e tratat ca sursa rupta (fara throw, fara persist)", async () => {
  const { deps, persistCalls } = makeAllNullDeps([
    { key: "cs2", error: "abort" },
    { key: "dota2", error: "abort" }
  ]);
  const svc = createUpdateNotificationService(deps);
  await svc.checkForUpdates(noopDiscordClient, [{ key: "cs2" }, { key: "dota2" }]);
  assert.deepEqual(persistCalls, [], "rezultatul all-null de la abort nu suprascrie snapshot-ul bun");
});

test("UpdateService: esec partial (un joc cu date, unul cu eroare) -> ciclu OK si snapshot persistat", async () => {
  const { deps, persistCalls } = makeAllNullDeps([
    { key: "cs2", latest: { id: "u-cs2" } },
    { key: "dota2", error: "ECONNRESET" }
  ]);
  const svc = createUpdateNotificationService(deps);
  await svc.checkForUpdates(noopDiscordClient, [{ key: "cs2" }, { key: "dota2" }]);
  assert.deepEqual(persistCalls, ["updates"], "cu macar un rezultat real, snapshot-ul se persista ca pana acum");
});
