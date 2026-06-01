"use strict";

import type { FilterQuery, Model } from "mongoose";
import type { GuildSettings, DealInfo } from "../../types";
import { buildDeadLetterEntry, DeadLetterEntry, deadLetterPush } from "./deadLetter";

const DISCORD_EMBEDS_PER_MESSAGE = 10;
const SNAPSHOT_FALLBACK_MAX_AGE_MS = 60 * 60 * 1000;

type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;

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

  claimSeenDiscount: (guildId: string, channelId: string, hash: string) => Promise<MongoWriteResult>;
  rollbackSeenDiscount: (guildId: string, hash: string) => Promise<MongoWriteResult>;
  loadSeenDiscountHashes: (guildId: string) => Promise<string[]>;
  disableDiscountsForChannelError: (guildId: string, channelId: string, message: string) => Promise<MongoWriteResult>;

  isPermanentDiscordError: (err: unknown) => boolean;
  transientErrorMessage: (err: unknown) => string;

  normalizePendingDiscountArray: (arr: unknown) => PendingDiscount[];
  validatePendingDiscountSnapshot: (snapshot: unknown) => boolean;
  normalizeCurrencyKey: (currency: unknown) => string;
  dealPassesFilters: (deal: unknown, guild: GuildSettings | null) => boolean;
  dealHash: (deal: unknown) => string;

  fetchDeals: (opts: { currency: string; fromCron?: boolean }) => Promise<DealInfo[]>;
  getDealsCacheData: (currency: string) => DealInfo[] | null;
  setDealsCache: (currency: string, deals: DealInfo[]) => void;
  persistFetchSnapshot?: (id: string, payload: unknown) => Promise<void>;
  loadFetchSnapshot?: (id: string) => Promise<{ payload: unknown; fetchedAt: Date } | null>;
  enrichDealData: (deal: DealInfo, currency: string) => Promise<DealInfo>;
  buildDealEmbed: (deal: DealInfo, mode: string, currency: string) => unknown;

  sleepIfPositive: (ms: number) => Promise<void>;

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
    claimSeenDiscount, rollbackSeenDiscount, loadSeenDiscountHashes, disableDiscountsForChannelError,
    isPermanentDiscordError, transientErrorMessage,
    normalizePendingDiscountArray, validatePendingDiscountSnapshot,
    normalizeCurrencyKey, dealPassesFilters, dealHash,
    fetchDeals, getDealsCacheData, setDealsCache, persistFetchSnapshot, loadFetchSnapshot, enrichDealData, buildDealEmbed,
    sleepIfPositive,
    DEFAULT_CURRENCY, PENDING_DISCOUNT_MAX_ATTEMPTS, PENDING_DISCOUNT_GRACE_CYCLES,
    PENDING_DISCOUNTS_LIMIT, MAX_DEALS_PER_CYCLE, DISCORD_SEND_DELAY_MS,
    GUILD_PROCESS_CONCURRENCY
  } = deps;

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

  async function processGuildDiscounts(client: unknown, guild: GuildSettings & Record<string, unknown>, deals: DealInfo[]): Promise<void> {
    const { channel, abort } = await resolveOutboundChannel({
      client,
      guild,
      channelId: (guild as { discountChannelId?: string | null }).discountChannelId,
      context: "CRON_DISCOUNTS",
      disableFn: disableDiscountsForChannelError
    });
    if (abort) return;

    const seenSet = new Set(await loadSeenDiscountHashes(String(guild._id)));
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
    const deadLettered: DeadLetterEntry[] = [];
    const currency = (guild as { currency?: string }).currency || DEFAULT_CURRENCY;
    const notificationMode = (guild as { notificationMode?: string }).notificationMode || "detailed";

    function retryOrDeadLetter(item: PendingDiscount, err: unknown): void {
      const retry: PendingDiscount = { ...item, attempts: (item.attempts || 0) + 1 };
      if (retry.attempts < PENDING_DISCOUNT_MAX_ATTEMPTS) remaining.push(retry);
      else deadLettered.push(buildDeadLetterEntry({
        kind: "discount", itemId: item.hash, title: (item.snapshot as { title?: unknown } | null)?.title,
        reason: transientErrorMessage(err), attempts: retry.attempts
      }));
    }

    const batch: Array<{ item: PendingDiscount; embed: unknown }> = [];
    let idx = 0;
    for (; idx < pending.length && batch.length < MAX_DEALS_PER_CYCLE; idx++) {
      const item = pending[idx];
      if (!item) continue;
      let claimed = false;
      try {
        const claim = await claimSeenDiscount(String(guild._id), channel.id, item.hash);
        if ((claim.matchedCount ?? 0) === 0) continue;
        claimed = true;
        const dealToSend = await enrichDealData(item.snapshot as DealInfo, currency);
        batch.push({ item, embed: buildDealEmbed(dealToSend, notificationMode, currency) });
      } catch (err: unknown) {
        if (claimed) await rollbackSeenDiscount(String(guild._id), item.hash).catch(() => null);
        if (isPermanentDiscordError(err)) {
          const reason = `Discord cod ${(err as { code?: unknown }).code}: ${transientErrorMessage(err)}`;
          await disableDiscountsForChannelError(String(guild._id), channel.id, reason).catch(() => null);
          logger("WARN", "CRON_DISCOUNTS", `Disable discounts pentru guild ${guild._id} - cod permanent`, reason);
          idx = pending.length;
          break;
        }
        retryOrDeadLetter(item, err);
        logger("WARN", "CRON_DISCOUNTS", "Nu am putut pregati reducerea", transientErrorMessage(err));
        idx++;
        break;
      }
    }
    remaining.push(...pending.slice(idx));

    const discountRoleId = (guild as { discountRoleId?: string }).discountRoleId;
    for (let start = 0; start < batch.length; start += DISCORD_EMBEDS_PER_MESSAGE) {
      const chunk = batch.slice(start, start + DISCORD_EMBEDS_PER_MESSAGE);
      const sendPayload: Record<string, unknown> = { embeds: chunk.map(entry => entry.embed) };
      if (start === 0 && discountRoleId) {
        sendPayload.content = `<@&${discountRoleId}>`;
        sendPayload.allowedMentions = { roles: [discountRoleId] };
      }
      try {
        await channel.send(sendPayload);
        await sleepIfPositive(DISCORD_SEND_DELAY_MS);
      } catch (err: unknown) {
        const failed = batch.slice(start);
        for (const entry of failed) await rollbackSeenDiscount(String(guild._id), entry.item.hash).catch(() => null);
        if (isPermanentDiscordError(err)) {
          const reason = `Discord cod ${(err as { code?: unknown }).code}: ${transientErrorMessage(err)}`;
          await disableDiscountsForChannelError(String(guild._id), channel.id, reason).catch(() => null);
          logger("WARN", "CRON_DISCOUNTS", `Disable discounts pentru guild ${guild._id} - cod permanent`, reason);
          break;
        }
        for (const entry of failed) retryOrDeadLetter(entry.item, err);
        logger("WARN", "CRON_DISCOUNTS", "Nu am putut trimite reduceri", transientErrorMessage(err));
        break;
      }
    }

    const discountUpdate: Record<string, unknown> = { $set: { pendingDiscounts: remaining.slice(-PENDING_DISCOUNTS_LIMIT) } };
    const push = deadLetterPush(deadLettered);
    if (push) discountUpdate.$push = push;
    await GuildModel.updateOne(
      { _id: guild._id, discountsSubscribed: true, discountChannelId: channel.id } as FilterQuery<GuildSettings>,
      discountUpdate
    );
  }

  async function checkForDiscounts(client: unknown, shouldAbort: (() => boolean) | null = null): Promise<void> {
    if (shouldAbort?.()) return;
    const guilds = await GuildModel.find({
      discountsSubscribed: true,
      discountChannelId: { $ne: null },
      discountsInitializing: { $ne: true }
    } as FilterQuery<GuildSettings>).lean();
    if (!guilds.length) return;

    const dealsPromises = new Map<string, Promise<DealInfo[]>>();
    async function dealsForCurrency(currency: unknown): Promise<DealInfo[]> {
      const cur = normalizeCurrencyKey(currency);
      const cached = getDealsCacheData(cur);
      if (cached) return cached;
      if (!dealsPromises.has(cur)) {
        dealsPromises.set(cur, fetchDeals({ currency: cur, fromCron: true }).then(async deals => {
          setDealsCache(cur, deals);
          if (persistFetchSnapshot) await persistFetchSnapshot(`deals:${cur}`, deals).catch(() => undefined);
          return deals;
        }).catch(async err => {
          const fallback = loadFetchSnapshot ? await loadFetchSnapshot(`deals:${cur}`).catch(() => null) : null;
          const fresh = !!fallback && fallback.fetchedAt != null
            && (Date.now() - new Date(fallback.fetchedAt).getTime()) < SNAPSHOT_FALLBACK_MAX_AGE_MS;
          if (fresh && fallback && Array.isArray(fallback.payload) && fallback.payload.length) {
            logger("WARN", "CRON_DISCOUNTS", `Fetch reduceri esuat pentru ${cur} — folosesc snapshot-ul recent din event store`, transientErrorMessage(err));
            return fallback.payload as DealInfo[];
          }
          throw err;
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
