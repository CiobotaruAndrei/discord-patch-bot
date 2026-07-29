"use strict";

import type mongoContext from "./mongoContext.js";
import type {
  AuditStore,
  DocumentCollection,
  GuildConfigStore,
  MongoPorts,
  NotificationStore,
  OperationStore,
  SecurityStore
} from "./mongoPorts.js";

type MongoContextValue = typeof mongoContext;

function collection(model: unknown): DocumentCollection {
  const source = model as DocumentCollection | null | undefined;
  if (source && typeof source.updateOne === "function" && typeof source.countDocuments === "function") return source;
  return {
    updateOne: async () => ({ matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }),
    countDocuments: async () => 0
  };
}

export function createGuildConfigStore(context: MongoContextValue): GuildConfigStore {
  return {
    guilds: collection(context.GuildModel),
    readSettings: guildId => context.getGuildSettings(guildId),
    invalidate: guildId => context.invalidateGuildCache(guildId),
    sweepExpired: () => context.cleanGuildCache(),
    cachedCount: () => context.getGuildCacheSize()
  };
}

export function createNotificationStore(context: MongoContextValue): NotificationStore {
  return {
    outbox: collection(context.NotificationOutboxModel),
    outboxSent: collection(context.NotificationOutboxSentModel),
    history: collection(context.NotificationHistoryModel),
    deadLetters: collection(context.GuildDeadLetterModel),
    deadLetterReplays: collection(context.NotificationDeadLetterReplayModel),
    seenDiscounts: collection(context.GuildSeenDiscountModel),
    seenUpdates: collection(context.GuildSeenUpdateModel),
    seenDlcs: collection(context.GuildSeenDlcModel),
    seenYoutube: collection(context.GuildSeenYoutubeModel)
  };
}

export function createSecurityStore(context: MongoContextValue): SecurityStore {
  return {
    newAccountAlerts: collection(context.NewAccountAlertDeliveryModel),
    channelLockRecoveries: collection(context.ChannelLockRecoveryModel),
    youtubeErrors: collection(context.GuildYoutubeErrorModel)
  };
}

export function createAuditStore(context: MongoContextValue): AuditStore {
  return {
    auditLog: collection(context.GuildAuditLogModel),
    configBackups: collection(context.GuildConfigBackupModel),
    suggestedCommands: collection(context.GuildSuggestedCommandModel)
  };
}

export function createOperationStore(context: MongoContextValue): OperationStore {
  return {
    journal: collection(context.OperationJournalModel),
    jobLocks: collection(context.JobLockModel),
    acquire: (jobName, ttlMs) => context.acquireDbLock(jobName, ttlMs),
    renew: (jobName, token, ttlMs) => context.renewDbLock(jobName, token, ttlMs),
    release: (jobName, token) => context.releaseDbLock(jobName, token)
  };
}

export function createMongoPorts(context: MongoContextValue): MongoPorts {
  return {
    guildConfig: createGuildConfigStore(context),
    notifications: createNotificationStore(context),
    security: createSecurityStore(context),
    audit: createAuditStore(context),
    operations: createOperationStore(context)
  };
}
