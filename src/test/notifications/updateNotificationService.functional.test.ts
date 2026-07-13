import test from "node:test";
import assert from "node:assert/strict";
import { createUpdateNotificationService } from "../../features/notifications/updateNotificationService.js";
import { makeUpdateDeps, noopDiscordClient } from "../notificationServiceTestKit.js";
import type { UpdateGuild, UpdateResults } from "../notificationServiceTestKit.js";

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
  const games = [{ key: "cs2", name: "CS2" }, { key: "fortnite", name: "Fortnite" }];
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
  await svc.checkForUpdates(noopDiscordClient, [{ key: "cs2", name: "CS2" }, { key: "fortnite", name: "Fortnite" }]);
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
  await svc.checkForUpdates(noopDiscordClient, [{ key: "cs2", name: "CS2" }, { key: "fortnite", name: "Fortnite" }]);
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
    { kind: "update", gameKey: "cs2", title: "Patch 1.5", link: "https://example.com/cs2", itemId: "u-cs2" }
  ], "serviciul nu mai scrie istoric direct; trimite intrarile prin meta catre canal (cu itemId pentru dedup stabil)");
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
  const { deps, rollbacks, deadLetterDocs } = makeUpdateDeps({
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
  assert.equal(deadLetterDocs.length, 1, "dupa epuizarea incercarilor itemul ajunge ca document in colectia guildDeadLetters, nu se pierde tacut");
  assert.equal(deadLetterDocs[0].guildId, "guild-1");
  assert.equal(deadLetterDocs[0].itemId, "u-1");
  assert.match(String(deadLetterDocs[0].reason), /embed corupt/);
});

test("UpdateService: daca rollback-ul claim-ului esueaza dupa embed corupt se logheaza WARN (nu inghitit tacut)", async () => {
  const logs: Array<{ level: string; msg: string }> = [];
  const channel = { id: "channel-1", send: async () => ({}) };
  const { deps } = makeUpdateDeps({
    resolveOutboundChannel: async () => ({ channel, abort: false }),
    buildUpdateEmbed: () => { throw new Error("embed corupt"); },
    rollbackSeenUpdate: async () => { throw new Error("mongo down la rollback"); },
    logger: (level: string, _ctx: string, msg: string) => { logs.push({ level, msg }); },
    PENDING_UPDATE_MAX_ATTEMPTS: 2
  });
  const svc = createUpdateNotificationService(deps);
  const guild = {
    _id: "guild-1", subscribed: true, notificationChannelId: "channel-1", seenHashVersionUpdates: 2,
    seen: {}, pendingUpdates: {}, enabledGames: []
  } as UpdateGuild;
  const latestResults = [{ game: { key: "cs2", name: "CS2" }, latest: { id: "u-1", title: "patch" } }] as UpdateResults;
  await svc.processGuildUpdates(noopDiscordClient, guild, latestResults);
  assert.ok(
    logs.some(l => l.level === "WARN" && /Rollback seen-update esuat/.test(l.msg)),
    "esecul rollback-ului lasa update-ul marcat vazut fara livrare; trebuie logat WARN, nu inghitit"
  );
});

test("UpdateService: livrarea care epuizeaza retry-urile intra in dead-letter (document in colectia dedicata)", async () => {
  const channel = { id: "channel-1", send: async () => { throw new Error("ECONNRESET"); } };
  const { deps, updateOneCalls, deadLetterDocs } = makeUpdateDeps({
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
  const update = updateOneCalls[0].update as { $push?: unknown };
  assert.equal(update.$push, undefined, "scrierea pe guild ramane doar $set, fara $push de dead-letter");
  assert.equal(deadLetterDocs.length, 1, "un item epuizat -> un document dead-letter in colectia dedicata");
  assert.deepEqual(
    { kind: deadLetterDocs[0].kind, itemId: deadLetterDocs[0].itemId, attempts: deadLetterDocs[0].attempts },
    { kind: "update", itemId: "u-1", attempts: 1 }
  );
});

test("UpdateService: un retry sub max NU scrie dead-letter (fara $push)", async () => {
  const channel = { id: "channel-1", send: async () => { throw new Error("ECONNRESET"); } };
  const { deps, updateOneCalls, deadLetterDocs } = makeUpdateDeps({
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
  assert.equal(deadLetterDocs.length, 0, "nicio intrare in colectia dedicata sub pragul de incercari");
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
    () => svc.checkForUpdates(noopDiscordClient, [{ key: "cs2", name: "CS2" }]),
    /snapshot de rezerva proaspat.*ECONNRESET total/,
    "regresie: functia facea return dupa logger.ERROR -> promisiunea se rezolva si cron-ul marca ciclul drept sanatos"
  );
});

test("UpdateService: fetch esuat CU snapshot proaspat -> checkForUpdates NU arunca (fallback functional)", async () => {
  const guild = { _id: "g1", subscribed: true, notificationChannelId: "channel-1", seenHashVersionUpdates: 2, pendingUpdates: {}, enabledGames: [] };
  const { deps } = makeUpdateDeps({
    GuildModel: { find: () => ({ lean: async () => [guild] }), updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }) },
    getLatestForAllGames: async () => { throw new Error("ECONNRESET total"); },
    loadFetchSnapshot: async () => ({ payload: [{ game: { key: "cs2", name: "CS2" }, latest: { id: "u-cs2" } }], fetchedAt: new Date() })
  });
  const svc = createUpdateNotificationService(deps);
  await svc.checkForUpdates(noopDiscordClient, [{ key: "cs2", name: "CS2" }]);
});

test("UpdateService: TOATE guild-urile esueaza la procesare -> checkForUpdates arunca", async () => {
  const guild = { _id: "g1", subscribed: true, notificationChannelId: "channel-1", seenHashVersionUpdates: 2, pendingUpdates: {}, enabledGames: [] };
  const { deps } = makeUpdateDeps({
    GuildModel: { find: () => ({ lean: async () => [guild] }), updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }) },
    resolveOutboundChannel: async () => { throw new Error("Discord indisponibil"); }
  });
  const svc = createUpdateNotificationService(deps);
  await assert.rejects(
    () => svc.checkForUpdates(noopDiscordClient, [{ key: "cs2", name: "CS2" }]),
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
  await svc.checkForUpdates(noopDiscordClient, [{ key: "cs2", name: "CS2" }]);
});

function makeAllNullDeps(results: Array<{ key: string; error?: string; latest?: { id: string } | null }>, extra: Record<string, unknown> = {}) {
  const persistCalls: string[] = [];
  const guild = { _id: "g1", subscribed: true, notificationChannelId: "channel-1", seenHashVersionUpdates: 2, pendingUpdates: {}, enabledGames: [] };
  const { deps } = makeUpdateDeps({
    GuildModel: { find: () => ({ lean: async () => [guild] }), updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }) },
    getLatestForAllGames: async () => results.map(entry => ({ game: { key: entry.key, name: entry.key }, latest: entry.latest ? { id: entry.latest.id, title: "", link: "", excerpt: "", fullText: "", image: null, thumbnail: null, timestamp: "" } : null, error: entry.error ?? null })),
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
    () => svc.checkForUpdates(noopDiscordClient, [{ key: "cs2", name: "CS2" }, { key: "dota2", name: "Dota2" }]),
    /latest: null.*2 cu erori reale.*snapshot de rezerva proaspat|snapshot de rezerva proaspat.*latest: null/,
    "regresie: erorile per-joc deveneau { latest: null, error } iar serviciul trata rezultatul ca fetch reusit"
  );
  assert.deepEqual(persistCalls, [], "snapshot-ul all-null NU se persista (ar deveni fallback fals-proaspat)");
});

test("UpdateService: toate null + erori reale, dar CU snapshot proaspat -> dispatch din snapshot, fara persist", async () => {
  const { deps, persistCalls } = makeAllNullDeps([{ key: "cs2", error: "ECONNRESET" }], {
    loadFetchSnapshot: async () => ({ payload: [{ game: { key: "cs2", name: "CS2" }, latest: { id: "u-cs2" } }], fetchedAt: new Date() })
  });
  const svc = createUpdateNotificationService(deps);
  await svc.checkForUpdates(noopDiscordClient, [{ key: "cs2", name: "CS2" }]);
  assert.deepEqual(persistCalls, [], "nici pe calea de fallback nu se persista rezultatul all-null");
});

test("UpdateService: toate null doar din abort -> NU e tratat ca sursa rupta (fara throw, fara persist)", async () => {
  const { deps, persistCalls } = makeAllNullDeps([
    { key: "cs2", error: "abort" },
    { key: "dota2", error: "abort" }
  ]);
  const svc = createUpdateNotificationService(deps);
  await svc.checkForUpdates(noopDiscordClient, [{ key: "cs2", name: "CS2" }, { key: "dota2", name: "Dota2" }]);
  assert.deepEqual(persistCalls, [], "rezultatul all-null de la abort nu suprascrie snapshot-ul bun");
});

test("UpdateService: esec partial (un joc cu date, unul cu eroare) -> ciclu OK si snapshot persistat", async () => {
  const { deps, persistCalls } = makeAllNullDeps([
    { key: "cs2", latest: { id: "u-cs2" } },
    { key: "dota2", error: "ECONNRESET" }
  ]);
  const svc = createUpdateNotificationService(deps);
  await svc.checkForUpdates(noopDiscordClient, [{ key: "cs2", name: "CS2" }, { key: "dota2", name: "Dota2" }]);
  assert.deepEqual(persistCalls, ["updates"], "cu macar un rezultat real, snapshot-ul se persista ca pana acum");
});
