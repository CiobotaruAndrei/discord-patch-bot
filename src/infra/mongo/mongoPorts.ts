"use strict";

import type { MongoContextExports } from "./mongoContext.js";

type Port<K extends keyof MongoContextExports> = Pick<MongoContextExports, K>;

export type GuildConfigStore = Port<
  "GuildModel" | "getGuildSettings" | "invalidateGuildCache" | "cleanGuildCache" | "getGuildCacheSize"
>;

export type NotificationStore = Port<
  | "NotificationOutboxModel"
  | "NotificationOutboxSentModel"
  | "NotificationHistoryModel"
  | "GuildDeadLetterModel"
  | "NotificationDeadLetterReplayModel"
  | "GuildSeenDiscountModel"
  | "GuildSeenUpdateModel"
  | "GuildSeenDlcModel"
  | "GuildSeenYoutubeModel"
>;

export type SecurityStore = Port<
  "NewAccountAlertDeliveryModel" | "ChannelLockRecoveryModel" | "GuildYoutubeErrorModel"
>;

export type AuditStore = Port<
  "GuildAuditLogModel" | "GuildConfigBackupModel" | "GuildSuggestedCommandModel"
>;

export type OperationStore = Port<"OperationJournalModel" | "JobLockModel" | "acquireDbLock" | "renewDbLock" | "releaseDbLock">;

export const MONGO_PORT_NAMES = [
  "GuildConfigStore",
  "NotificationStore",
  "SecurityStore",
  "AuditStore",
  "OperationStore"
] as const;

export type MongoPortName = (typeof MONGO_PORT_NAMES)[number];
