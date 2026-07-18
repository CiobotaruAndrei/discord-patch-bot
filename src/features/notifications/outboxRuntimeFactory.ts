"use strict";

import type { OutboxHistoryEntry } from "./notificationOutbox.js";
import type { DrainOutboxWorkerResult } from "./outboxTypes.js";
import type { OutboxDiscordClient } from "./outboundChannel.js";
import type { NotificationsRuntimeDeps } from "./notificationRuntimeContracts.js";

import {
  createOutboundChannelResolver,
  isPermanentDiscordError
} from "./outboundChannel.js";
import { createHistoryRepository } from "./historyRepository.js";
import { createOutboxRuntime, applyDedupeMarker, messageHasDedupeMarker, outboxDedupeMarker } from "./notificationOutbox.js";
import { createOutboxDelivery } from "./outboxDelivery.js";
import { buildDeadLetterEntry, deadLetterTitleFromPayload } from "./deadLetter.js";
import { recordDeadLetters } from "./deadLetterRepository.js";
import { createDeadLetterReplayRepository } from "./deadLetterReplayRepository.js";
import { createDefaultDiscordSendLimiter } from "./discordRateLimiter.js";

export const OUTBOX_MAX_ATTEMPTS = 5;
export const OUTBOX_BACKOFF_MS = 60_000;

export interface OutboxJobShape { _id?: unknown; guildId: string; channelId: string; kind: "update" | "discount" | "youtube" | "future-release"; payload: unknown; attempts?: number; deliveries?: number; dedupeKey?: string; recoveryVerify?: boolean; manual?: boolean; history?: OutboxHistoryEntry[]; }

export function outboxSubscriptionFilter(job: OutboxJobShape): Record<string, unknown> {
  if (job.kind === "discount") return { _id: job.guildId, discountsSubscribed: true, discountChannelId: job.channelId };
  if (job.kind === "youtube") {
    return {
      _id: job.guildId,
      ...(job.manual ? {} : { youtubeNotificationsEnabled: true }),
      $or: [
        { youtubeNotificationChannelId: job.channelId },
        { "youtubeChannelRoutes.discordChannelIds": job.channelId }
      ]
    };
  }
  if (job.kind === "future-release") {
    return { _id: job.guildId, futureReleaseSubscribed: true, futureReleaseChannelId: job.channelId };
  }
  return { _id: job.guildId, subscribed: true, notificationChannelId: job.channelId };
}

export function createIsStillSubscribed(GuildModel: { countDocuments(filter: Record<string, unknown>): Promise<number> }) {
  return (job: OutboxJobShape): Promise<boolean> => GuildModel.countDocuments(outboxSubscriptionFilter(job)).then(count => count > 0);
}

export function createOutboxServices(deps: NotificationsRuntimeDeps) {
  const {
    NOTIFICATION_OUTBOX_ENABLED: outboxEnabled,
    NOTIFICATION_OUTBOX_DRAIN_LIMIT: OUTBOX_DRAIN_LIMIT,
    NOTIFICATION_OUTBOX_MAX_AGE_MS: OUTBOX_MAX_AGE_MS,
    NOTIFICATION_OUTBOX_RECOVERY_VERIFY: OUTBOX_RECOVERY_VERIFY,
    NOTIFICATION_OUTBOX_RECOVERY_STRICT: OUTBOX_RECOVERY_STRICT,
    NOTIFICATION_OUTBOX_RECOVERY_HISTORY_LIMIT: OUTBOX_RECOVERY_HISTORY_LIMIT
  } = deps.env;
  const {
    GuildModel, GuildDeadLetterModel, logger, canSendEmbeds, withMongoRetry,
    NotificationOutboxModel, NotificationOutboxSentModel, NotificationHistoryModel, NotificationDeadLetterReplayModel
  } = deps;

  const outbox = createOutboxRuntime({ NotificationOutboxModel, NotificationOutboxSentModel, withMongoRetry, logger });
  const enqueueOutbox = outboxEnabled ? outbox.enqueueOutbox : undefined;
  const deadLetterReplayRepository = createDeadLetterReplayRepository({ NotificationDeadLetterReplayModel, withMongoRetry, logger });
  const historyRepository = createHistoryRepository({ NotificationHistoryModel, withMongoRetry, logger });

  const sendLimiter = createDefaultDiscordSendLimiter(deps.env);
  const resolveOutboundChannel = createOutboundChannelResolver({ logger, canSendEmbeds, acquireSendSlot: () => sendLimiter.acquire(), enqueueOutbox, recordSentHistory: historyRepository.recordSent });

  const outboxDelivery = createOutboxDelivery({
    canSendEmbeds,
    isPermanentDiscordError,
    acquireSendSlot: () => sendLimiter.acquire(),
    applyDedupeMarker, messageHasDedupeMarker, outboxDedupeMarker,
    recoveryVerify: OUTBOX_RECOVERY_VERIFY,
    recoveryStrict: OUTBOX_RECOVERY_STRICT,
    historyLimit: OUTBOX_RECOVERY_HISTORY_LIMIT
  });

  async function recordOutboxDeadLetter(job: OutboxJobShape, reason: string): Promise<void> {
    await recordDeadLetters(GuildDeadLetterModel, job.guildId, [buildDeadLetterEntry({
      kind: job.kind, itemId: String(job._id ?? ""), title: deadLetterTitleFromPayload(job.payload), channelId: job.channelId, dedupeKey: job.dedupeKey, reason, attempts: (job.attempts || 0) + 1
    })]).catch((err: unknown) => logger("WARN", "OUTBOX", `Nu am putut scrie intrarea de audit dead-letter pentru guild ${job.guildId} (poate diverge de payload-ul de replay)`, err));
    await deadLetterReplayRepository.recordPayload({
      guildId: job.guildId, kind: job.kind, channelId: job.channelId, payload: job.payload,
      dedupeKey: job.dedupeKey, recoveryVerify: job.recoveryVerify, reason, itemId: String(job._id ?? ""),
      history: job.history
    });
  }

  async function drainOutbox(client: OutboxDiscordClient, shouldAbort?: () => boolean): Promise<DrainOutboxWorkerResult> {
    const result = await outbox.drainOutbox({
      deliver: (job: OutboxJobShape) => outboxDelivery.deliver(client, job),
      isStillSubscribed: createIsStillSubscribed(GuildModel),
      recordDeadLetter: recordOutboxDeadLetter,
      recordSentHistory: historyRepository.recordSent,
      maxAttempts: OUTBOX_MAX_ATTEMPTS,
      backoffMs: OUTBOX_BACKOFF_MS,
      limit: OUTBOX_DRAIN_LIMIT,
      maxAgeMs: OUTBOX_MAX_AGE_MS,
      shouldAbort
    });
    const recoveryVerifyEnabledGuilds = await GuildModel.countDocuments({ outboxRecoveryVerify: true }).catch(() => undefined);
    return typeof recoveryVerifyEnabledGuilds === "number" ? { ...result, recoveryVerifyEnabledGuilds } : result;
  }

  return { enqueueOutbox, resolveOutboundChannel, drainOutbox, deadLetterReplayRepository, historyRepository };
}

export type OutboxServices = ReturnType<typeof createOutboxServices>;
export type OutboundChannelResolver = OutboxServices["resolveOutboundChannel"];
