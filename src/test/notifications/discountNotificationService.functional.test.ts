import test from "node:test";
import assert from "node:assert/strict";
import { createDiscountNotificationService } from "../../features/notifications/discountNotificationService.js";
import { makeDiscountDeps, noopDiscordClient } from "../notificationServiceTestKit.js";
import type { DiscountGuild, DiscountDeals } from "../notificationServiceTestKit.js";
import type { DealInfo } from "../../types.js";

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
    { kind: "discount", title: "Game A", link: "https://example.com/deal-a", itemId: "d1" }
  ], "serviciul nu mai scrie istoric direct; trimite intrarile prin meta catre canal (cu itemId=dealHash pentru dedup stabil)");
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
    enrichDealData: async (deal: DealInfo) => { enrichCount++; return deal; }
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

test("DiscountService: livrarea care epuizeaza retry-urile intra in dead-letter (document in colectia dedicata)", async () => {
  const channel = { id: "channel-d", send: async () => { throw new Error("ECONNRESET"); } };
  const { deps, updateOneCalls, deadLetterDocs } = makeDiscountDeps({
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
  const update = updateOneCalls[0].update as { $push?: unknown };
  assert.equal(update.$push, undefined, "scrierea pe guild ramane doar $set, fara $push de dead-letter");
  assert.equal(deadLetterDocs.length, 1, "un deal epuizat -> un document dead-letter in colectia dedicata");
  assert.deepEqual(
    { kind: deadLetterDocs[0].kind, itemId: deadLetterDocs[0].itemId, attempts: deadLetterDocs[0].attempts },
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
