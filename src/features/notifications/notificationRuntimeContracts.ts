"use strict";

import type { Model } from "mongoose";
import type { PriceValue, RuntimeEnv } from "../../types.js";
import type { SeenRepositoryDeps } from "./seenRepository.js";
import type { UpdateNotificationServiceDeps } from "./updateNotificationService.js";
import type { DiscountNotificationServiceDeps } from "./discountNotificationService.js";
import type { OutboxRuntimeDeps } from "./notificationOutbox.js";
import type { HistoryRepositoryDeps } from "./historyRepository.js";
import type { DeadLetterReplayRepositoryDeps } from "./deadLetterReplayRepository.js";
import type { SourceRegistryApi } from "../../sources/sourceRegistry.js";
import type { GuildDeadLetterDoc, GuildSeenYoutubeDoc, GuildYoutubeErrorDoc } from "../../infra/mongo/modelTypes.js";
import type { ReportRollbackFailure } from "./rollbackReporter.js";

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
    GuildModel: { countDocuments(filter: Record<string, unknown>): Promise<number> };
    canSendEmbeds(channel: unknown, botId: string): boolean;
    formatPrice(value: PriceValue, currencyCode?: string | null): string;
    saveFetchSnapshot?: (id: string, payload: unknown) => Promise<void>;
    NotificationOutboxModel: OutboxRuntimeDeps["NotificationOutboxModel"];
    NotificationOutboxSentModel: OutboxRuntimeDeps["NotificationOutboxSentModel"];
    NotificationHistoryModel: HistoryRepositoryDeps["NotificationHistoryModel"];
    NotificationDeadLetterReplayModel: DeadLetterReplayRepositoryDeps["NotificationDeadLetterReplayModel"];
    GuildSeenYoutubeModel: Model<GuildSeenYoutubeDoc>;
    GuildYoutubeErrorModel: Model<GuildYoutubeErrorDoc>;
    GuildDeadLetterModel: Model<GuildDeadLetterDoc>;
    httpReq: SourceRegistryApi["httpReq"];
    safeCheerioLoad: SourceRegistryApi["safeCheerioLoad"];
    FETCH_CONCURRENCY: number;
    PRICE_ALERT_REARM_ABSENT_CYCLES: number;
    adminAlert?: (kind: string, title: string, body: unknown, guildId?: string) => Promise<unknown>;
  };

export function createReportRollbackFailure(deps: NotificationsRuntimeDeps): ReportRollbackFailure {
  return (context, error) => {
    void deps.adminAlert?.(
      `rollback-failed:${context.kind}`,
      "Rollback deduplicare esuat",
      `${context.kind} ${context.itemId} (guild ${context.guildId}): ${error instanceof Error ? error.message : String(error)}`,
      context.guildId
    )?.catch(() => undefined);
  };
}
