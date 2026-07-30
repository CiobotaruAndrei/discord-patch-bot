"use strict";

import type { MongoWriteOutcome } from "../../types.js";
import type { FutureReleaseGameEntry } from "../admin-records/adminRecordsTypes.js";
import type { SteamAppDetailsSummary } from "../../sources/sourceApis.js";
import type { SteamSearchItem } from "../../types.js";
import type { NotificationDiscordClient, ResolveOutboundChannelResult } from "./outboundChannel.js";
import {
  computeFutureReleaseUpdate,
  initialFutureReleaseState,
  parseReleaseTimestamp,
  type FutureReleaseGameState,
  type FutureReleaseNotification,
  type FutureReleaseObservation,
  type FutureReleaseThresholdDay
} from "./futureReleaseNotifications.js";
import {
  disableFutureReleaseForChannelError,
  finishFutureReleaseInitialization,
  persistFutureReleaseState
} from "../admin-records/futureReleaseGamesRepository.js";

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type ResolveOutboundChannel = (opts: {
  client: NotificationDiscordClient;
  guild: FutureReleaseGuildDoc;
  channelId: string | null | undefined;
  context: string;
  disableFn: (guildId: string, channelId: string, message: string) => Promise<MongoWriteOutcome>;
}) => Promise<ResolveOutboundChannelResult>;

export interface FutureReleaseGuildDoc {
  _id: string | number;
  futureReleaseChannelId?: string | null;
  futureReleaseActivationId?: string | null;
  futureReleaseInitializing?: boolean;
  futureReleaseGames?: FutureReleaseGameEntry[];
  currency?: string;
  outboxRecoveryVerify?: boolean;
}

interface FutureReleaseGuildModelLike {
  find(filter: Record<string, unknown>): { lean(): Promise<FutureReleaseGuildDoc[]> };
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>
  ): Promise<MongoWriteOutcome>;
}

interface ObservationResult {
  observation: FutureReleaseObservation;
  sourceAppId?: string;
}

export interface FutureReleaseNotificationServiceDeps {
  GuildModel: FutureReleaseGuildModelLike;
  logger: Logger;
  resolveOutboundChannel: ResolveOutboundChannel;
  searchSteamGameByName(query: string, currency: string): Promise<SteamSearchItem[]>;
  chooseBestSteamMatch(items: SteamSearchItem[], query: string, options?: { forceGameOnly?: boolean }): SteamSearchItem | null;
  fetchSteamPriceDetails(appId: string | number, currency: string): Promise<SteamAppDetailsSummary | null>;
  DEFAULT_CURRENCY: string;
  now?: () => Date;
}

function validThresholds(value: number[] | undefined): FutureReleaseThresholdDay[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is FutureReleaseThresholdDay => entry === 30 || entry === 7 || entry === 1);
}

function stateFromEntry(entry: FutureReleaseGameEntry): FutureReleaseGameState {
  if (entry.baselineDone !== true) return initialFutureReleaseState();
  return {
    baselineDone: true,
    notifiedThresholdDays: validThresholds(entry.notifiedThresholdDays),
    preorderSeen: entry.preorderSeen === true,
    observedPreorderPrice: typeof entry.observedPreorderPrice === "string" ? entry.observedPreorderPrice : null
  };
}

function displaySteamPrice(details: SteamAppDetailsSummary, currency: string): string | null {
  const price = details.price_overview;
  if (!price) return null;
  const formatted = price.final_formatted?.trim();
  if (formatted) return formatted;
  if (!Number.isFinite(price.final)) return null;
  return `${(price.final / 100).toFixed(2)} ${currency}`;
}

function manualObservation(entry: FutureReleaseGameEntry): FutureReleaseObservation {
  return {
    gameName: entry.gameName,
    releaseDate: entry.releaseDate || null,
    preorderPrice: entry.preorderPrice || null
  };
}

function notificationEmbed(notification: FutureReleaseNotification): Record<string, unknown> {
  if (notification.kind === "threshold") {
    return {
      title: `${notification.gameName}: lansare in ${notification.days} zile`,
      description: `Data de lansare urmarita: ${notification.releaseDate}`,
      color: 0x5865f2
    };
  }
  if (notification.kind === "preorder-available") {
    return {
      title: `${notification.gameName}: precomanda disponibila`,
      description: `Pret observat: ${notification.price}`,
      color: 0x57f287
    };
  }
  if (notification.kind === "price-changed") {
    return {
      title: `${notification.gameName}: pretul precomenzii s-a schimbat`,
      description: `${notification.from} -> ${notification.to}`,
      color: 0xfee75c
    };
  }
  return {
    title: `${notification.gameName}: precomanda nu mai este disponibila`,
    color: 0xed4245
  };
}

function notificationItemId(notification: FutureReleaseNotification): string {
  if (notification.kind === "threshold") return `${notification.gameName}:threshold:${notification.days}:${notification.releaseDate}`;
  if (notification.kind === "preorder-available") return `${notification.gameName}:preorder:${notification.price}`;
  if (notification.kind === "price-changed") return `${notification.gameName}:price:${notification.from}:${notification.to}`;
  return `${notification.gameName}:preorder-removed`;
}

export function createFutureReleaseNotificationService(deps: FutureReleaseNotificationServiceDeps) {
  const { GuildModel, logger, resolveOutboundChannel } = deps;
  const clock = deps.now ?? (() => new Date());

  async function fetchObservation(entry: FutureReleaseGameEntry, currency: string, at: Date): Promise<ObservationResult | null> {
    let appId = entry.sourceAppId?.trim() || "";
    if (!appId) {
      const matches = await deps.searchSteamGameByName(entry.gameName, currency);
      const best = deps.chooseBestSteamMatch(matches, entry.gameName, { forceGameOnly: true });
      appId = best?.id == null ? "" : String(best.id);
      if (!appId) return { observation: manualObservation(entry) };
    }
    const details = await deps.fetchSteamPriceDetails(appId, currency);
    if (!details) return null;
    const releaseDate = details.release_date?.date?.trim() || entry.releaseDate || null;
    const releaseTs = parseReleaseTimestamp(releaseDate);
    const isFuture = details.release_date?.coming_soon === true || (releaseTs !== null && releaseTs >= at.getTime());
    return {
      sourceAppId: appId,
      observation: {
        gameName: details.name?.trim() || entry.gameName,
        releaseDate,
        preorderPrice: isFuture ? displaySteamPrice(details, currency) : null
      }
    };
  }

  async function processGuild(client: NotificationDiscordClient, guild: FutureReleaseGuildDoc, shouldAbort?: (() => boolean) | null): Promise<void> {
    const guildId = String(guild._id);
    const activationId = guild.futureReleaseActivationId?.trim();
    if (!activationId) return;
    const resolved = await resolveOutboundChannel({
      client,
      guild,
      channelId: guild.futureReleaseChannelId,
      context: "CRON_FUTURE_RELEASE",
      disableFn: (id, channelId) => disableFutureReleaseForChannelError(GuildModel, id, channelId)
    });
    if (resolved.abort) return;
    const currency = guild.currency?.trim() || deps.DEFAULT_CURRENCY;
    const entries = Array.isArray(guild.futureReleaseGames) ? guild.futureReleaseGames.slice(0, 20) : [];
    let initializationComplete = true;

    for (const entry of entries) {
      if (shouldAbort?.()) return;
      const at = clock();
      let observed: ObservationResult | null;
      try {
        observed = await fetchObservation(entry, currency, at);
      } catch (error) {
        initializationComplete = initializationComplete && entry.baselineDone === true;
        logger("WARN", "CRON_FUTURE_RELEASE", `Sursa future-release a esuat pentru ${entry.gameName}`, error);
        continue;
      }
      if (!observed) {
        initializationComplete = initializationComplete && entry.baselineDone === true;
        logger("WARN", "CRON_FUTURE_RELEASE", `Sursa future-release nu a returnat date pentru ${entry.gameName}`);
        continue;
      }
      const computed = computeFutureReleaseUpdate(observed.observation, stateFromEntry(entry), at.getTime());
      for (const notification of computed.notifications) {
        const itemId = notificationItemId(notification);
        await resolved.channel.send(
          { embeds: [notificationEmbed(notification)] },
          {
            historyEntries: [{
              kind: "future-release",
              gameKey: entry.gameName,
              title: String(notificationEmbed(notification).title || "Future release"),
              itemId
            }]
          }
        );
      }
      const persisted = await persistFutureReleaseState(
        GuildModel,
        guildId,
        activationId,
        entry.gameName,
        {
          ...computed.nextState,
          sourceAppId: observed.sourceAppId,
          releaseDate: observed.observation.releaseDate,
          preorderPrice: observed.observation.preorderPrice
        },
        at
      );
      if (!persisted) return;
    }

    if (guild.futureReleaseInitializing && initializationComplete) {
      await finishFutureReleaseInitialization(GuildModel, guildId, activationId);
    }
  }

  async function checkForFutureReleases(client: NotificationDiscordClient, shouldAbort: (() => boolean) | null = null): Promise<void> {
    if (shouldAbort?.()) return;
    const guilds = await GuildModel.find({
      futureReleaseSubscribed: true,
      futureReleaseChannelId: { $ne: null },
      futureReleaseActivationId: { $type: "string" }
    }).lean();
    for (const guild of guilds) {
      if (shouldAbort?.()) return;
      try {
        await processGuild(client, guild, shouldAbort);
      } catch (error) {
        logger("WARN", "CRON_FUTURE_RELEASE", `Procesarea future-release a esuat pentru guild ${guild._id}`, error);
      }
    }
  }

  return { checkForFutureReleases, processGuild, fetchObservation };
}

export default { createFutureReleaseNotificationService };
