"use strict";

import type { MongoWriteOutcome } from "../../types.js";
import type { RunConcurrent } from "../../shared/concurrencyPort.js";
import type { GuildSettings } from "../guild-config/guildSettingsTypes.js";
import type { NotificationMode, PendingDiscount } from "./notificationTypes.js";
import type { DealInfo, ValidatedDealInfo } from "../../sources/sourceTypes.js";
type MongoUpdate = Record<string, unknown>;
import { buildDeadLetterEntry, DeadLetterEntry } from "./deadLetter.js";
import type { NotificationEmbed } from "./notificationTypes.js";
import type { DeadLetterModelLike } from "./deadLetterRepository.js";
import type { NotificationDiscordClient, ResolveOutboundChannelResult } from "./outboundChannel.js";
import { HASH_VERSION } from "../../native/fuzzy.js";

import { persistGuildCycleState } from "./notificationCycleRepository.js";
import { buildDealsHashIndex, planDiscountFailure, planPendingDiscounts } from "./discountNotificationPlanner.js";
import type { ReportRollbackFailure } from "./rollbackReporter.js";
import { loadNotificationFeed } from "./notificationFeedLoader.js";
import { runGuildNotificationCycle, type NotificationCycleEnvironment } from "./notificationCycle.js";
import { cronContextFor, subscriptionFilterFor, type NotificationKind } from "../../shared/notificationKinds.js";

const NOTIFICATION_KIND: NotificationKind = "discount";
const CRON_CONTEXT = cronContextFor(NOTIFICATION_KIND);
const DISCORD_EMBEDS_PER_MESSAGE = 10;
const SNAPSHOT_FALLBACK_MAX_AGE_MS = 60 * 60 * 1000;

type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;

type MongoWriteResult = MongoWriteOutcome;

interface GuildModelLike {
  find(filter: Record<string, unknown>): { lean(): Promise<Array<GuildSettings>> };
  updateOne(filter: Record<string, unknown>, update: MongoUpdate): Promise<MongoWriteResult>;
}


type ResolveOutboundChannel = (opts: {
  client: NotificationDiscordClient;
  guild: GuildSettings;
  channelId: string | null | undefined;
  context: string;
  disableFn: (guildId: string, channelId: string, message: string) => Promise<MongoWriteResult>;
}) => Promise<ResolveOutboundChannelResult>;

export interface DiscountNotificationServiceDeps {
  GuildModel: GuildModelLike;
  GuildDeadLetterModel: Pick<DeadLetterModelLike, "insertMany" | "find" | "deleteMany">;
  logger: Logger;
  runConcurrent: RunConcurrent;
  resolveOutboundChannel: ResolveOutboundChannel;

  claimSeenDiscount: (guildId: string, channelId: string, hash: string) => Promise<MongoWriteResult>;
  rollbackSeenDiscount: (guildId: string, hash: string) => Promise<MongoWriteResult>;
  loadSeenDiscountHashes: (guildId: string, candidateHashes?: string[]) => Promise<string[]>;
  seedSeenDiscounts: (guildId: string, hashes: string[]) => Promise<void>;
  setSeenHashVersion: (guildId: string, field: "seenHashVersionUpdates" | "seenHashVersionDiscounts", version: number) => Promise<MongoWriteResult>;
  disableDiscountsForChannelError: (guildId: string, channelId: string, message: string) => Promise<MongoWriteResult>;
  reportRollbackFailure?: ReportRollbackFailure;

  isPermanentDiscordError: (err: unknown) => boolean;
  transientErrorMessage: (err: unknown) => string;

  normalizePendingDiscountArray: (arr: unknown) => PendingDiscount[];
  validatePendingDiscountSnapshot: (snapshot: unknown) => snapshot is ValidatedDealInfo;
  normalizeCurrencyKey: (currency: unknown) => string;
  dealPassesFilters: (deal: DealInfo | null | undefined, guild: GuildSettings | null) => boolean;
  dealHash: (deal: DealInfo) => string;

  fetchDeals: (opts: { currency: string; fromCron?: boolean }) => Promise<DealInfo[]>;
  getDealsCacheData: (currency: string) => DealInfo[] | null;
  setDealsCache: (currency: string, deals: DealInfo[]) => void;
  persistFetchSnapshot?: (id: string, payload: unknown) => Promise<void>;
  loadFetchSnapshot?: (id: string) => Promise<{ payload: unknown; fetchedAt: Date } | null>;
  enrichDealData: (deal: DealInfo, currency: string) => Promise<DealInfo>;
  buildDealEmbed: (deal: DealInfo, mode: NotificationMode, currency: string) => NotificationEmbed;

  sleepIfPositive: (ms: number) => Promise<void>;
  processGuildPriceAlerts: ReturnType<typeof import("./priceAlertService.js").createPriceAlertService>["processGuildPriceAlerts"];

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
  processGuildDiscounts: (client: NotificationDiscordClient, guild: GuildSettings, deals: DealInfo[]) => Promise<void>;
  checkForDiscounts: (client: NotificationDiscordClient, shouldAbort?: (() => boolean) | null) => Promise<void>;
}

export function createDiscountNotificationService(deps: DiscountNotificationServiceDeps): DiscountNotificationService {
  const {
    GuildModel, GuildDeadLetterModel, logger, runConcurrent, resolveOutboundChannel,
    claimSeenDiscount, rollbackSeenDiscount, loadSeenDiscountHashes, seedSeenDiscounts, setSeenHashVersion, disableDiscountsForChannelError, reportRollbackFailure,
    isPermanentDiscordError, transientErrorMessage,
    normalizePendingDiscountArray, validatePendingDiscountSnapshot,
    normalizeCurrencyKey, dealPassesFilters, dealHash,
    fetchDeals, getDealsCacheData, setDealsCache, persistFetchSnapshot, loadFetchSnapshot, enrichDealData, buildDealEmbed,
    sleepIfPositive, processGuildPriceAlerts,
    DEFAULT_CURRENCY, PENDING_DISCOUNT_MAX_ATTEMPTS, PENDING_DISCOUNT_GRACE_CYCLES,
    PENDING_DISCOUNTS_LIMIT, MAX_DEALS_PER_CYCLE, DISCORD_SEND_DELAY_MS,
    GUILD_PROCESS_CONCURRENCY
  } = deps;

  const cycleEnvironment: NotificationCycleEnvironment = {
    logger, isPermanentDiscordError, transientErrorMessage, sleepIfPositive, reportRollbackFailure,
    maxEmbedsPerMessage: DISCORD_EMBEDS_PER_MESSAGE,
    sendDelayMs: DISCORD_SEND_DELAY_MS
  };

  const dealsHashIndexCache = new WeakMap<DealInfo[], ReturnType<typeof buildDealsHashIndex>>();

  function getDealsHashIndex(deals: DealInfo[]) {
    let cached = dealsHashIndexCache.get(deals);
    if (cached) return cached;
    cached = buildDealsHashIndex(deals, dealHash);
    dealsHashIndexCache.set(deals, cached);
    return cached;
  }

  async function processGuildDiscounts(client: NotificationDiscordClient, guild: GuildSettings, deals: DealInfo[]): Promise<void> {
    const { channel, abort } = await resolveOutboundChannel({
      client,
      guild,
      channelId: guild.discountChannelId,
      context: CRON_CONTEXT,
      disableFn: disableDiscountsForChannelError
    });
    if (abort) return;

    const { dealsByHash, orderedHashes } = getDealsHashIndex(deals);

    if (Number(guild.seenHashVersionDiscounts) !== HASH_VERSION) {
      if (orderedHashes.length) await seedSeenDiscounts(String(guild._id), orderedHashes);
      await setSeenHashVersion(String(guild._id), "seenHashVersionDiscounts", HASH_VERSION);
      logger("INFO", CRON_CONTEXT, `Re-baseline dedup reduceri pentru guild ${guild._id} (hashVersion -> ${HASH_VERSION}); ciclul curent nu trimite notificari`);
      return;
    }

    const oldPending = normalizePendingDiscountArray(guild.pendingDiscounts);
    const candidateHashes = Array.from(new Set([...oldPending.map(item => item.hash), ...orderedHashes]));
    const seenSet = new Set(await loadSeenDiscountHashes(String(guild._id), candidateHashes));
    const pending = planPendingDiscounts({
      oldPending,
      orderedHashes,
      dealsByHash,
      seenSet,
      now: new Date(),
      maxAttempts: PENDING_DISCOUNT_MAX_ATTEMPTS,
      graceCycles: PENDING_DISCOUNT_GRACE_CYCLES,
      limit: PENDING_DISCOUNTS_LIMIT,
      passesFilters: deal => dealPassesFilters(deal, guild),
      validateSnapshot: validatePendingDiscountSnapshot
    });

    const claimRetries: PendingDiscount[] = [];
    const sendRetries: PendingDiscount[] = [];
    const deadLettered: DeadLetterEntry[] = [];
    const currency = guild.currency || DEFAULT_CURRENCY;
    const notificationMode: NotificationMode = guild.notificationMode === "compact" ? "compact" : "detailed";

    function retryOrDeadLetter(item: PendingDiscount, err: unknown, retries: PendingDiscount[]): void {
      const failure = planDiscountFailure(item, PENDING_DISCOUNT_MAX_ATTEMPTS);
      if (failure.action === "requeue") retries.push(failure.retry);
      else deadLettered.push(buildDeadLetterEntry({
        kind: NOTIFICATION_KIND, itemId: item.hash, title: item.snapshot?.title,
        reason: transientErrorMessage(err), attempts: failure.attempts
      }));
    }

    await runGuildNotificationCycle<PendingDiscount>(cycleEnvironment, {
      kind: NOTIFICATION_KIND,
      guildId: String(guild._id),
      channel,
      limit: MAX_DEALS_PER_CYCLE,
      candidates: pending.filter(item => Boolean(item)),
      identify: item => ({
        itemId: item.hash,
        describe: `reducerea ${item.hash}`,
        history: {
          title: item.snapshot?.title || "",
          link: item.snapshot?.url || item.snapshot?.link || "",
          itemId: item.hash
        }
      }),
      claim: item => claimSeenDiscount(String(guild._id), channel.id, item.hash),
      buildEmbed: async item => {
        const snapshot = item.snapshot;
        if (!snapshot) throw new Error(`PendingDiscount ${item.hash} fara snapshot valid`);
        return buildDealEmbed(await enrichDealData(snapshot, currency), notificationMode, currency);
      },
      releaseClaim: item => rollbackSeenDiscount(String(guild._id), item.hash),
      disableChannel: reason => disableDiscountsForChannelError(String(guild._id), channel.id, reason),
      onClaimFailure: (item, err) => { retryOrDeadLetter(item, err, claimRetries); },
      onSendFailure: (failed, err) => {
        for (const item of failed) retryOrDeadLetter(item, err, sendRetries);
      },
      transientPolicy: "stop",
      messageTemplate: guild.discountMessageTemplate,
      roleId: guild.discountRoleId,
      persist: async outcome => {
        const pendingOut = [...claimRetries, ...outcome.unclaimed, ...sendRetries];
        await persistGuildCycleState(
          GuildModel, GuildDeadLetterModel, String(guild._id),
          subscriptionFilterFor({ kind: NOTIFICATION_KIND, guildId: String(guild._id), channelId: channel.id }),
          { pendingDiscounts: pendingOut.slice(-PENDING_DISCOUNTS_LIMIT) }, deadLettered
        );
      }
    });
  }

  async function checkForDiscounts(client: NotificationDiscordClient, shouldAbort: (() => boolean) | null = null): Promise<void> {
    if (shouldAbort?.()) return;
    const guilds = await GuildModel.find({
      discountsSubscribed: true,
      discountChannelId: { $ne: null },
      discountsInitializing: { $ne: true }
    }).lean();
    if (!guilds.length) return;

    const dealsPromises = new Map<string, Promise<DealInfo[]>>();
    async function dealsForCurrency(currency: unknown): Promise<DealInfo[]> {
      const cur = normalizeCurrencyKey(currency);
      const cached = getDealsCacheData(cur);
      if (cached) return cached;
      if (!dealsPromises.has(cur)) {
        dealsPromises.set(cur, loadNotificationFeed({
          snapshotId: `deals:${cur}`,
          fetchFresh: () => fetchDeals({ currency: cur, fromCron: true }),
          validateItem: validatePendingDiscountSnapshot,
          persistFresh: async deals => {
            setDealsCache(cur, deals);
            if (persistFetchSnapshot) await persistFetchSnapshot(`deals:${cur}`, deals).catch(() => undefined);
          },
          loadSnapshot: loadFetchSnapshot,
          maxSnapshotAgeMs: SNAPSHOT_FALLBACK_MAX_AGE_MS,
          invalidSnapshotItemPolicy: "reject-snapshot",
          onFallback: error => logger("WARN", CRON_CONTEXT, `Fetch reduceri esuat pentru ${cur}; folosesc snapshot-ul recent din event store`, transientErrorMessage(error))
        }));
      }
      return dealsPromises.get(cur) as Promise<DealInfo[]>;
    }

    const dispatch = await runConcurrent(guilds, GUILD_PROCESS_CONCURRENCY, async (guild) => {
      if (shouldAbort?.()) return;
      const currency = normalizeCurrencyKey((guild as { currency?: string }).currency || DEFAULT_CURRENCY);
      const deals = await dealsForCurrency(currency);
      await processGuildDiscounts(client, guild, deals);
      const dealsByCurrency = new Map<string, DealInfo[]>([[currency, deals]]);
      const alertCurrencies = Array.from(new Set(
        (Array.isArray(guild.priceAlerts) ? guild.priceAlerts : [])
          .map(alert => normalizeCurrencyKey(alert.currency))
          .filter(alertCurrency => alertCurrency !== currency)
      ));
      for (const alertCurrency of alertCurrencies) {
        try {
          dealsByCurrency.set(alertCurrency, await dealsForCurrency(alertCurrency));
        } catch (err: unknown) {
          logger("WARN", "PRICE_ALERT", `Nu am putut citi ofertele ${alertCurrency} pentru guild ${guild._id}`, transientErrorMessage(err));
        }
      }
      await processGuildPriceAlerts(client, guild, dealsByCurrency);
    }, {
      errorLogger: (guild, err) =>
        logger("WARN", CRON_CONTEXT, `Eroare procesare guild ${guild._id}`, transientErrorMessage(err))
    });
    if (dispatch.processed === 0 && dispatch.errors.length > 0) {
      throw new Error(`Reducerile au esuat pentru toate cele ${dispatch.errors.length} guild-uri abonate (fetch sau procesare): ${transientErrorMessage(dispatch.errors[0]?.error)}`);
    }
  }

  return { processGuildDiscounts, checkForDiscounts };
}
