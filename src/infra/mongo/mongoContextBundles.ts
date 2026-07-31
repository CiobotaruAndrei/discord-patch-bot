"use strict";

import type mongoContext from "./mongoContext.js";

type MongoContextValue = typeof mongoContext;

export type MongoRepositoriesBundle = Pick<
  MongoContextValue,
  | "GuildModel"
  | "GuildAuditLogModel"
  | "GuildConfigBackupModel"
  | "GuildSuggestedCommandModel"
  | "GuildModerationModel"
  | "GuildSecurityModel"
  | "GuildYoutubeStateModel"
  | "GuildYoutubeErrorModel"
  | "GuildDeadLetterModel"
  | "CircuitBreakerModel"
  | "SystemModel"
  | "JobLockModel"
  | "AdminAlertCooldownModel"
  | "FetchSnapshotModel"
  | "PlayerCountSnapshotModel"
  | "PlayerCountHistoryModel"
  | "ReviewTrendSnapshotModel"
  | "DealPriceSnapshotModel"
  | "NewAccountAlertDeliveryModel"
  | "ChannelLockRecoveryModel"
  | "PlayerCountRecordModel"
  | "BugReportModel"
  | "UserComplaintModel"
  | "GuildSeenDiscountModel"
  | "GuildSeenUpdateModel"
  | "GuildSeenYoutubeModel"
  | "GuildSeenDlcModel"
  | "NotificationOutboxModel"
  | "NotificationOutboxSentModel"
  | "NotificationHistoryModel"
  | "FeedbackReportModel"
  | "NotificationDeadLetterReplayModel"
  | "OperationJournalModel"
>;

export type MongoLocksBundle = Pick<
  MongoContextValue,
  "acquireDbLock" | "renewDbLock" | "releaseDbLock" | "activeLocks"
>;

export type MongoMigrationsBundle = Pick<MongoContextValue, "runMigrations" | "ALL_MIGRATIONS">;

export type MongoSnapshotsBundle = Pick<
  MongoContextValue,
  "saveFetchSnapshot" | "loadFetchSnapshot" | "loadDealsFetchSnapshots" | "loadSourceHealth"
>;

export type MongoAdministrationBundle = Pick<MongoContextValue, "adminAlert" | "setAdminAlertDiscordClient">;

export interface MongoContextBundles {
  repositories: MongoRepositoriesBundle;
  locks: MongoLocksBundle;
  migrations: MongoMigrationsBundle;
  snapshots: MongoSnapshotsBundle;
  administration: MongoAdministrationBundle;
}

export function selectMongoRepositories(context: MongoRepositoriesBundle): MongoRepositoriesBundle {
  return {
    GuildModel: context.GuildModel,
    GuildAuditLogModel: context.GuildAuditLogModel,
    GuildConfigBackupModel: context.GuildConfigBackupModel,
    GuildSuggestedCommandModel: context.GuildSuggestedCommandModel,
    GuildModerationModel: context.GuildModerationModel,
    GuildSecurityModel: context.GuildSecurityModel,
    GuildYoutubeStateModel: context.GuildYoutubeStateModel,
    GuildYoutubeErrorModel: context.GuildYoutubeErrorModel,
    GuildDeadLetterModel: context.GuildDeadLetterModel,
    CircuitBreakerModel: context.CircuitBreakerModel,
    SystemModel: context.SystemModel,
    JobLockModel: context.JobLockModel,
    AdminAlertCooldownModel: context.AdminAlertCooldownModel,
    FetchSnapshotModel: context.FetchSnapshotModel,
    PlayerCountSnapshotModel: context.PlayerCountSnapshotModel,
    PlayerCountHistoryModel: context.PlayerCountHistoryModel,
    ReviewTrendSnapshotModel: context.ReviewTrendSnapshotModel,
    DealPriceSnapshotModel: context.DealPriceSnapshotModel,
    NewAccountAlertDeliveryModel: context.NewAccountAlertDeliveryModel,
    ChannelLockRecoveryModel: context.ChannelLockRecoveryModel,
    PlayerCountRecordModel: context.PlayerCountRecordModel,
    BugReportModel: context.BugReportModel,
    UserComplaintModel: context.UserComplaintModel,
    GuildSeenDiscountModel: context.GuildSeenDiscountModel,
    GuildSeenUpdateModel: context.GuildSeenUpdateModel,
    GuildSeenYoutubeModel: context.GuildSeenYoutubeModel,
    GuildSeenDlcModel: context.GuildSeenDlcModel,
    NotificationOutboxModel: context.NotificationOutboxModel,
    NotificationOutboxSentModel: context.NotificationOutboxSentModel,
    NotificationHistoryModel: context.NotificationHistoryModel,
    FeedbackReportModel: context.FeedbackReportModel,
    NotificationDeadLetterReplayModel: context.NotificationDeadLetterReplayModel,
    OperationJournalModel: context.OperationJournalModel
  };
}

export function selectMongoLocks(context: MongoLocksBundle): MongoLocksBundle {
  return {
    acquireDbLock: context.acquireDbLock,
    renewDbLock: context.renewDbLock,
    releaseDbLock: context.releaseDbLock,
    activeLocks: context.activeLocks
  };
}

export function selectMongoMigrations(context: MongoMigrationsBundle): MongoMigrationsBundle {
  return {
    runMigrations: context.runMigrations,
    ALL_MIGRATIONS: context.ALL_MIGRATIONS
  };
}

export function selectMongoSnapshots(context: MongoSnapshotsBundle): MongoSnapshotsBundle {
  return {
    saveFetchSnapshot: context.saveFetchSnapshot,
    loadFetchSnapshot: context.loadFetchSnapshot,
    loadDealsFetchSnapshots: context.loadDealsFetchSnapshots,
    loadSourceHealth: context.loadSourceHealth
  };
}

export function selectMongoAdministration(context: MongoAdministrationBundle): MongoAdministrationBundle {
  return {
    adminAlert: context.adminAlert,
    setAdminAlertDiscordClient: context.setAdminAlertDiscordClient
  };
}

export function composeMongoContextBundles(context: MongoContextValue): MongoContextBundles {
  return {
    repositories: selectMongoRepositories(context),
    locks: selectMongoLocks(context),
    migrations: selectMongoMigrations(context),
    snapshots: selectMongoSnapshots(context),
    administration: selectMongoAdministration(context)
  };
}
