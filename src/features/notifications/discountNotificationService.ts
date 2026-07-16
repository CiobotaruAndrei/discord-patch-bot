"use strict";

import type { GuildSettings, DealInfo, MongoWriteOutcome, PendingDiscount, NotificationMode, ValidatedDealInfo } from "../../types.js";
type MongoUpdate = Record<string, unknown>;
import { buildDeadLetterEntry, DeadLetterEntry } from "./deadLetter.js";
import type { NotificationEmbed } from "./notificationTypes.js";
import type { DeadLetterModelLike } from "./deadLetterRepository.js";
import type { NotificationDiscordClient, ResolveOutboundChannelResult } from "./outboundChannel.js";
import { HASH_VERSION } from "../../native/fuzzy.js";

import { sendEmbedBatch } from "./notificationBatchExecutor.js";
import { persistGuildCycleState } from "./notificationCycleRepository.js";
import { buildDealsHashIndex, planDiscountFailure, planPendingDiscounts } from "./discountNotificationPlanner.js";
import { rollbackOrReport, type ReportRollbackFailure } from "./rollbackReporter.js";
import { loadNotificationFeed } from "./notificationFeedLoader.js";

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

interface RunConcurrentOptions<T> {
  errorLogger?: (item: T, err: unknown) => void;
}
interface RunConcurrentResult {
  processed: number;
  errors: Array<{ error: unknown }>;
}
type RunConcurrent = <T>(items: T[], concurrency: number, fn: (item: T) => Promise<unknown>, opts?: RunConcurrentOptions<T>) => Promise<RunConcurrentResult>;

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
      context: "CRON_DISCOUNTS",
      disableFn: disableDiscountsForChannelError
    });
    if (abort) return;

    const { dealsByHash, orderedHashes } = getDealsHashIndex(deals);

    if (Number(guild.seenHashVersionDiscounts) !== HASH_VERSION) {
      if (orderedHashes.length) await seedSeenDiscounts(String(guild._id), orderedHashes);
      await setSeenHashVersion(String(guild._id), "seenHashVersionDiscounts", HASH_VERSION);
      logger("INFO", "CRON_DISCOUNTS", `Re-baseline dedup reduceri pentru guild ${guild._id} (hashVersion -> ${HASH_VERSION}); ciclul curent nu trimite notificari`);
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

    const remaining: PendingDiscount[] = [];
    const deadLettered: DeadLetterEntry[] = [];
    const currency = guild.currency || DEFAULT_CURRENCY;
    const notificationMode: NotificationMode = guild.notificationMode === "compact" ? "compact" : "detailed";

    function retryOrDeadLetter(item: PendingDiscount, err: unknown): void {
      const failure = planDiscountFailure(item, PENDING_DISCOUNT_MAX_ATTEMPTS);
      if (failure.action === "requeue") remaining.push(failure.retry);
      else deadLettered.push(buildDeadLetterEntry({
        kind: "discount", itemId: item.hash, title: item.snapshot?.title,
        reason: transientErrorMessage(err), attempts: failure.attempts
      }));
    }

    const batch: Array<{ item: PendingDiscount; embed: NotificationEmbed }> = [];
    let idx = 0;
    for (; idx < pending.length && batch.length < MAX_DEALS_PER_CYCLE; idx++) {
      const item = pending[idx];
      if (!item) continue;
      let claimed = false;
      try {
        const claim = await claimSeenDiscount(String(guild._id), channel.id, item.hash);
        if ((claim.matchedCount ?? 0) === 0) continue;
        claimed = true;
        const snapshot = item.snapshot;
        if (!snapshot) throw new Error(`PendingDiscount ${item.hash} fara snapshot valid`);
        const dealToSend = await enrichDealData(snapshot, currency);
        batch.push({ item, embed: buildDealEmbed(dealToSend, notificationMode, currency) });
      } catch (err: unknown) {
        if (claimed) {
          await rollbackOrReport(
            () => rollbackSeenDiscount(String(guild._id), item.hash),
            logger,
            { guildId: String(guild._id), kind: "discount", itemId: item.hash },
            reportRollbackFailure
          );
        }
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

    const discountRoleId = guild.discountRoleId;
    const messageTemplate = guild.discountMessageTemplate;
    await sendEmbedBatch({
      channel,
      batch,
      embedOf: entry => entry.embed,
      historyEntryFor: entry => {
        const snapshot = entry.item.snapshot;
        return {
          kind: "discount" as const,
          title: snapshot?.title || "",
          link: snapshot?.url || snapshot?.link || "",
          itemId: entry.item.hash
        };
      },
      messageTemplate,
      roleId: discountRoleId,
      maxEmbedsPerMessage: DISCORD_EMBEDS_PER_MESSAGE,
      sendDelayMs: DISCORD_SEND_DELAY_MS,
      sleepIfPositive,
      isPermanentDiscordError,
      transientErrorMessage,
      rollbackEntry: entry => rollbackSeenDiscount(String(guild._id), entry.item.hash),
      rollbackFailureContext: entry => ({ guildId: String(guild._id), kind: "discount", itemId: entry.item.hash }),
      reportRollbackFailure,
      logger,
      onPermanentError: async reason => {
        await disableDiscountsForChannelError(String(guild._id), channel.id, reason).catch(() => null);
        logger("WARN", "CRON_DISCOUNTS", `Disable discounts pentru guild ${guild._id} - cod permanent`, reason);
      },
      onTransientFailure: (failed, err) => {
        for (const entry of failed) retryOrDeadLetter(entry.item, err);
        logger("WARN", "CRON_DISCOUNTS", "Nu am putut trimite reduceri", transientErrorMessage(err));
      }
    });

    await persistGuildCycleState(
      GuildModel, GuildDeadLetterModel, String(guild._id),
      { _id: guild._id, discountsSubscribed: true, discountChannelId: channel.id },
      { pendingDiscounts: remaining.slice(-PENDING_DISCOUNTS_LIMIT) }, deadLettered
    );
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
          onFallback: error => logger("WARN", "CRON_DISCOUNTS", `Fetch reduceri esuat pentru ${cur}; folosesc snapshot-ul recent din event store`, transientErrorMessage(error))
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
        logger("WARN", "CRON_DISCOUNTS", `Eroare procesare guild ${guild._id}`, transientErrorMessage(err))
    });
    if (dispatch.processed === 0 && dispatch.errors.length > 0) {
      throw new Error(`Reducerile au esuat pentru toate cele ${dispatch.errors.length} guild-uri abonate (fetch sau procesare): ${transientErrorMessage(dispatch.errors[0]?.error)}`);
    }
  }

  return { processGuildDiscounts, checkForDiscounts };
}
