"use strict";

import type { Model } from "mongoose";
import type { PriceValue } from "../../types.js";
import type { RuntimeEnv } from "../../config/runtimeEnvTypes.js";
import type { SeenRepositoryDeps } from "./seenRepository.js";
import type { UpdateNotificationServiceDeps } from "./updateNotificationService.js";
import type { DiscountNotificationServiceDeps } from "./discountNotificationService.js";
import type { OutboxRuntimeDeps } from "./notificationOutbox.js";
import type { HistoryRepositoryDeps } from "./historyRepository.js";
import type { DeadLetterReplayRepositoryDeps } from "./deadLetterReplayRepository.js";
import type { SourceRegistryApi } from "../../sources/sourceRegistry.js";
import type { GuildDeadLetterDoc, GuildSeenYoutubeDoc, GuildYoutubeErrorDoc } from "../../infra/mongo/modelTypes.js";
import type { ReportRollbackFailure } from "./rollbackReporter.js";
import type { FutureReleaseGuildDoc } from "./futureReleaseNotificationService.js";
import type { YoutubeSliceReaderModel } from "../youtube/youtubeStateReader.js";

export type GeneratedUpdateDeps =
  | "resolveOutboundChannel"
  | "claimSeenUpdate"
  | "rollbackSeenUpdate"
  | "seedSeenUpdates"
  | "setSeenHashVersion"
  | "disableUpdatesForChannelError"
  | "isPermanentDiscordError"
  | "transientErrorMessage";

export type GeneratedDiscountDeps =
  | "resolveOutboundChannel"
  | "claimSeenDiscount"
  | "rollbackSeenDiscount"
  | "loadSeenDiscountHashes"
  | "seedSeenDiscounts"
  | "setSeenHashVersion"
  | "disableDiscountsForChannelError"
  | "rollbackTriggeredAlert"
  | "isPermanentDiscordError"
  | "transientErrorMessage"
  | "processGuildPriceAlerts";

export type NotificationsRuntimeDeps = SeenRepositoryDeps
  & Omit<UpdateNotificationServiceDeps, GeneratedUpdateDeps>
  & Omit<DiscountNotificationServiceDeps, GeneratedDiscountDeps>
  & {
    env: RuntimeEnv;
    GuildModel: {
      countDocuments(filter: Record<string, unknown>): Promise<number>;
      find(filter: Record<string, unknown>): { lean(): Promise<FutureReleaseGuildDoc[]> };
      updateOne(
        filter: Record<string, unknown>,
        update: Record<string, unknown> | Array<Record<string, unknown>>,
        options?: Record<string, unknown>
      ): Promise<{ matchedCount?: number; modifiedCount?: number }>;
    };
    canSendEmbeds(channel: unknown, botId: string): boolean;
    formatPrice(value: PriceValue, currencyCode?: string | null): string;
    saveFetchSnapshot?: (id: string, payload: unknown) => Promise<void>;
    NotificationOutboxModel: OutboxRuntimeDeps["NotificationOutboxModel"];
    NotificationOutboxSentModel: OutboxRuntimeDeps["NotificationOutboxSentModel"];
    NotificationHistoryModel: HistoryRepositoryDeps["NotificationHistoryModel"];
    NotificationDeadLetterReplayModel: DeadLetterReplayRepositoryDeps["NotificationDeadLetterReplayModel"];
    GuildSeenYoutubeModel: Model<GuildSeenYoutubeDoc>;
    GuildYoutubeStateModel?: YoutubeSliceReaderModel;
    GuildYoutubeErrorModel: Model<GuildYoutubeErrorDoc>;
    GuildDeadLetterModel: Model<GuildDeadLetterDoc>;
    httpReq: SourceRegistryApi["httpReq"];
    safeCheerioLoad: SourceRegistryApi["safeCheerioLoad"];
    searchSteamGameByName: SourceRegistryApi["searchSteamGameByName"];
    chooseBestSteamMatch: SourceRegistryApi["chooseBestSteamMatch"];
    fetchSteamPriceDetails: SourceRegistryApi["fetchSteamPriceDetails"];
    FETCH_CONCURRENCY: number;
    PRICE_ALERT_REARM_ABSENT_CYCLES: number;
    adminAlert?: (kind: string, title: string, body: unknown, guildId?: string) => Promise<unknown>;
  };

export function createReportRollbackFailure(deps: NotificationsRuntimeDeps): ReportRollbackFailure {
  return async (context, error) => {
    const message = error instanceof Error ? error.message : String(error);
    await deps.GuildDeadLetterModel.insertMany([{
      guildId: context.guildId,
      kind: context.kind,
      itemId: context.itemId,
      title: "Rollback reconciliation required",
      reason: message,
      attempts: 1,
      failedAt: new Date()
    }], { ordered: false }).catch(persistError => {
      deps.logger("WARN", "ROLLBACK", `Persistarea reconcilierii rollback a esuat pentru ${context.kind}/${context.itemId}`, persistError);
    });
    await deps.adminAlert?.(
      `rollback-failed:${context.kind}`,
      "Rollback deduplicare esuat",
      `${context.kind} ${context.itemId} (guild ${context.guildId}): ${message}`,
      context.guildId
    )?.catch(() => undefined);
  };
}
