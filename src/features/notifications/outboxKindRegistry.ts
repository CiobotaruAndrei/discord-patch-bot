"use strict";

import type { OutboxJob, OutboxKind } from "./outboxTypes.js";

export type OutboxKindDefinition = {
  subscriptionFilter: (job: OutboxJob) => Record<string, unknown>;
};

const DEFINITIONS: Record<OutboxKind, OutboxKindDefinition> = {
  update: { subscriptionFilter: job => ({ _id: job.guildId, subscribed: true, notificationChannelId: job.channelId }) },
  discount: { subscriptionFilter: job => ({ _id: job.guildId, discountsSubscribed: true, discountChannelId: job.channelId }) },
  youtube: { subscriptionFilter: job => ({
    _id: job.guildId,
    ...(job.manual ? {} : { youtubeNotificationsEnabled: true }),
    $or: [{ youtubeNotificationChannelId: job.channelId }, { "youtubeChannelRoutes.discordChannelIds": job.channelId }]
  }) }
};

export function outboxKindDefinition(kind: OutboxKind): OutboxKindDefinition {
  return DEFINITIONS[kind];
}

export function outboxSubscriptionFilterFromRegistry(job: OutboxJob): Record<string, unknown> {
  return outboxKindDefinition(job.kind).subscriptionFilter(job);
}

export const OUTBOX_KIND_REGISTRY = Object.freeze(DEFINITIONS);
