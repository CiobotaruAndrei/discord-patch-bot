"use strict";

/**
 * V12: DiscountNotificationService — extras din `notifications/index.ts`
 * simetric cu UpdateNotificationService.
 *
 * Modulul concentreaza intregul flow de notificari de reduceri:
 * - `processGuildDiscounts`: per guild, draina coada pendingDiscounts,
 *   dispatcheaza maxim N reduceri/ciclu, cu retry tolerant si rollback pe
 *   blip-uri Mongo.
 * - `checkForDiscounts`: top-level cron entry — interogheaza guild-urile
 *   subscribed, fetch-uieste deals per currency (cu deduplicare WeakMap pe
 *   index hash) si proceseaza in paralel.
 *
 * Deps tipate explicit. Functiile depind de SeenRepository (claim/rollback/
 * disable) si OutboundChannelResolver injectate.
 */

import type { Model } from "mongoose";
import type { GuildSettings, DealInfo } from "../../types";

type Logger = (level: string, ctx: string, msg: string, meta?: unknown) => void;

interface MongoWriteResult { matchedCount?: number; modifiedCount?: number }

interface OutboundChannel {
  id: string;
  send: (payload: unknown) => Promise<unknown>;
}

interface ResolvedChannel {
  channel: OutboundChannel;
  abort: boolean;
}

type ResolveOutboundChannel = (opts: {
  client: unknown;
  guild: GuildSettings & Record<string, unknown>;
  channelId: string | null | undefined;
  context: string;
  disableFn: (guildId: string, channelId: string, message: string) => Promise<MongoWriteResult>;
}) => Promise<ResolvedChannel>;

interface RunConcurrentOptions {
  errorLogger?: (item: unknown, err: unknown) => void;
}
type RunConcurrent = <T>(items: T[], concurrency: number, fn: (item: T) => Promise<unknown>, opts?: RunConcurrentOptions) => Promise<void>;

interface PendingDiscount {
  hash: string;
  snapshot: DealInfo | null;
  lastSeenAt: Date;
  attempts: number;
}

export interface DiscountNotificationServiceDeps {
  GuildModel: Pick<Model<GuildSettings>, "find" | "updateOne">;
  logger: Logger;
  runConcurrent: RunConcurrent;
  resolveOutboundChannel: ResolveOutboundChannel;
  // SeenRepository operations
  claimSeenDiscount: (guildId: string, channelId: string, hash: string) => Promise<MongoWriteResult>;
  rollbackSeenDiscount: (guildId: string, hash: string) => Promise<MongoWriteResult>;
  disableDiscountsForChannelError: (guildId: string, channelId: string, message: string) => Promise<MongoWriteResult>;
  // Discord helpers
  isPermanentDiscordError: (err: unknown) => boolean;
  transientErrorMessage: (err: unknown) => string;
  // Pure utils
  normalizePendingDiscountArray: (arr: unknown) => PendingDiscount[];
  validatePendingDiscountSnapshot: (snapshot: unknown) => boolean;
  normalizeCurrencyKey: (currency: unknown) => string;
  dealPassesFilters: (deal: unknown, guild: GuildSettings | null) => boolean;
  dealHash: (deal: unknown) => string;
  // Fetch + embed
  fetchDeals: (opts: { currency: string; fromCron?: boolean }) => Promise<DealInfo[]>;
  getDealsCacheData: (currency: string) => DealInfo[] | null;
  setDealsCache: (currency: string, deals: DealInfo[]) => void;
  enrichDealData: (deal: DealInfo, currency: string) => Promise<DealInfo>;
  buildDealEmbed: (deal: DealInfo, mode: string, currency: string) => unknown;
  // Misc
  sleepIfPositive: (ms: number) => Promise<void>;
  // Limits
  DEFAULT_CURRENCY: string;
  DEALS_HISTORY_LIMIT: number;
  PENDING_DISCOUNT_MAX_ATTEMPTS: number;
  PENDING_DISCOUNT_GRACE_CYCLES: number;
  PENDING_DISCOUNTS_LIMIT: number;
  MAX_DEALS_PER_CYCLE: number;
  DISCORD_SEND_DELAY_MS: number;
  GUILD_PROCESS_CONCURRENCY: number;
}

export interface DiscountNotificationService {
  processGuildDiscounts: (client: unknown, guild: GuildSettings & Record<string, unknown>, deals: DealInfo[]) => Promise<void>;
  checkForDiscounts: (client: unknown, shouldAbort?: (() => boolean) | null) => Promise<void>;
}

export function createDiscountNotificationService(deps: DiscountNotificationServiceDeps): DiscountNotificationService {
  const {
    GuildModel, logger, runConcurrent, resolveOutboundChannel,
    claimSeenDiscount, rollbackSeenDiscount, disableDiscountsForChannelError,
    isPermanentDiscordError, transientErrorMessage,
    normalizePendingDiscountArray, validatePendingDiscountSnapshot,
    normalizeCurrencyKey, dealPassesFilters, dealHash,
    fetchDeals, getDealsCacheData, setDealsCache, enrichDealData, buildDealEmbed,
    sleepIfPositive,
    DEFAULT_CURRENCY, PENDING_DISCOUNT_MAX_ATTEMPTS, PENDING_DISCOUNT_GRACE_CYCLES,
    PENDING_DISCOUNTS_LIMIT, MAX_DEALS_PER_CYCLE, DISCORD_SEND_DELAY_MS,
    GUILD_PROCESS_CONCURRENCY
  } = deps;

  // V11: indexul (hash -> snapshot) este derivat din array-ul `deals` returnat
  // de fetchDeals si nu se schimba intre guild-uri in acelasi ciclu cron.
  // WeakMap keyed pe referinta array-ului ne lasa sa hash-uim O data per ciclu
  // (per currency), nu N x M unde N = numar de guild-uri.
  const dealsHashIndexCache = new WeakMap<DealInfo[], { dealsByHash: Map<string, DealInfo>; orderedHashes: string[] }>();

  function getDealsHashIndex(deals: DealInfo[]) {
    let cached = dealsHashIndexCache.get(deals);
    if (cached) return cached;
    const dealsByHash = new Map<string, DealInfo>();
    const orderedHashes: string[] = [];
    for (const deal of deals) {
      const hash = dealHash(deal);
      if (!dealsByHash.has(hash)) {
        dealsByHash.set(hash, deal);
        orderedHashes.push(hash);
      }
    }
    cached = { dealsByHash, orderedHashes };
    dealsHashIndexCache.set(deals, cached);
    return cached;
  }

  // V9: mentiune rol pe prima trimitere doar.
  async function processGuildDiscounts(client: unknown, guild: GuildSettings & Record<string, unknown>, deals: DealInfo[]): Promise<void> {
    const { channel, abort } = await resolveOutboundChannel({
      client,
      guild,
      channelId: (guild as { discountChannelId?: string | null }).discountChannelId,
      context: "CRON_DISCOUNTS",
      disableFn: disableDiscountsForChannelError
    });
    if (abort) return;

    const seenSet = new Set(
      Array.isArray((guild as { seenDiscounts?: unknown[] }).seenDiscounts)
        ? (guild as { seenDiscounts: unknown[] }).seenDiscounts.map(String)
        : []
    );
    const { dealsByHash, orderedHashes } = getDealsHashIndex(deals);
    const pending: PendingDiscount[] = [];
    for (const old of normalizePendingDiscountArray((guild as { pendingDiscounts?: unknown }).pendingDiscounts)) {
      if (seenSet.has(old.hash) || old.attempts >= PENDING_DISCOUNT_MAX_ATTEMPTS) continue;
      const fresh = dealsByHash.get(old.hash);
      if (fresh) {
        if (dealPassesFilters(fresh, guild)) {
          pending.push({ hash: old.hash, snapshot: fresh, lastSeenAt: new Date(), attempts: old.attempts || 0 });
        }
      } else if (old.attempts < PENDING_DISCOUNT_GRACE_CYCLES
          && validatePendingDiscountSnapshot(old.snapshot)
          && dealPassesFilters(old.snapshot, guild)) {
        pending.push({ ...old, attempts: (old.attempts || 0) + 1 });
      }
    }

    const pendingHashes = new Set(pending.map(item => item.hash));
    for (const hash of orderedHashes) {
      if (seenSet.has(hash) || pendingHashes.has(hash)) continue;
      const deal = dealsByHash.get(hash);
      if (!deal || !dealPassesFilters(deal, guild)) continue;
      pending.push({ hash, snapshot: deal, lastSeenAt: new Date(), attempts: 0 });
      pendingHashes.add(hash);
      if (pending.length >= PENDING_DISCOUNTS_LIMIT) break;
    }

    const remaining: PendingDiscount[] = [];
    let sentCount = 0;
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      if (!item) continue;
      if (sentCount >= MAX_DEALS_PER_CYCLE) {
        remaining.push(...pending.slice(i));
        break;
      }
      let claimed = false;
      try {
        // V12: claim INAINTE de enrich, simetric cu processGuildUpdates.
        const claim = await claimSeenDiscount(String(guild._id), channel.id, item.hash);
        if ((claim.matchedCount ?? 0) === 0) continue;
        claimed = true;
        const currency = (guild as { currency?: string }).currency || DEFAULT_CURRENCY;
        const dealToSend = await enrichDealData(item.snapshot as DealInfo, currency);
        const sendPayload: Record<string, unknown> = {
          embeds: [buildDealEmbed(dealToSend, (guild as { notificationMode?: string }).notificationMode || "detailed", currency)]
        };
        // V9: ping rol doar pe prima trimitere.
        const discountRoleId = (guild as { discountRoleId?: string }).discountRoleId;
        if (sentCount === 0 && discountRoleId) {
          sendPayload.content = `<@&${discountRoleId}>`;
          sendPayload.allowedMentions = { roles: [discountRoleId] };
        }
        await channel.send(sendPayload);
        sentCount++;
        await sleepIfPositive(DISCORD_SEND_DELAY_MS);
      } catch (err: unknown) {
        if (claimed) await rollbackSeenDiscount(String(guild._id), item.hash).catch(() => null);
        if (isPermanentDiscordError(err)) {
          const reason = `Discord cod ${(err as { code?: unknown }).code}: ${transientErrorMessage(err)}`;
          await disableDiscountsForChannelError(String(guild._id), channel.id, reason).catch(() => null);
          logger("WARN", "CRON_DISCOUNTS", `Disable discounts pentru guild ${guild._id} - cod permanent`, reason);
          remaining.push(...pending.slice(i + 1));
          break;
        }
        const retry: PendingDiscount = { ...item, attempts: (item.attempts || 0) + 1 };
        if (retry.attempts < PENDING_DISCOUNT_MAX_ATTEMPTS) remaining.push(retry);
        remaining.push(...pending.slice(i + 1));
        logger("WARN", "CRON_DISCOUNTS", "Nu am putut trimite reducere", transientErrorMessage(err));
        break;
      }
    }

    await GuildModel.updateOne(
      { _id: guild._id, discountsSubscribed: true, discountChannelId: channel.id } as any,
      { $set: { pendingDiscounts: remaining.slice(-PENDING_DISCOUNTS_LIMIT) } }
    );
  }

  async function checkForDiscounts(client: unknown, shouldAbort: (() => boolean) | null = null): Promise<void> {
    if (shouldAbort?.()) return;
    const guilds = await GuildModel.find({
      discountsSubscribed: true,
      discountChannelId: { $ne: null },
      discountsInitializing: { $ne: true }
    } as any).lean();
    if (!guilds.length) return;

    const dealsPromises = new Map<string, Promise<DealInfo[]>>();
    async function dealsForCurrency(currency: unknown): Promise<DealInfo[]> {
      const cur = normalizeCurrencyKey(currency);
      const cached = getDealsCacheData(cur);
      if (cached) return cached;
      if (!dealsPromises.has(cur)) {
        dealsPromises.set(cur, fetchDeals({ currency: cur, fromCron: true }).then(deals => {
          setDealsCache(cur, deals);
          return deals;
        }));
      }
      return dealsPromises.get(cur) as Promise<DealInfo[]>;
    }

    await runConcurrent(guilds as Array<GuildSettings & Record<string, unknown>>, GUILD_PROCESS_CONCURRENCY, async (guild) => {
      if (shouldAbort?.()) return;
      const currency = (guild as { currency?: string }).currency || DEFAULT_CURRENCY;
      const deals = await dealsForCurrency(currency);
      await processGuildDiscounts(client, guild, deals);
    }, {
      errorLogger: (guild: unknown, err: unknown) =>
        logger("WARN", "CRON_DISCOUNTS", `Eroare procesare guild ${(guild as { _id?: unknown })._id}`, transientErrorMessage(err))
    });
  }

  return { processGuildDiscounts, checkForDiscounts };
}
