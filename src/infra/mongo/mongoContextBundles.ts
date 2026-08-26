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
  | "PermissionRequestModel"
  | "ProtectedResourceModel"
  | "WebhookSnapshotModel"
  | "MassModerationModel"
  | "RaidSnapshotModel"
  | "AuditEntryClaimModel"
  | "RaidIncidentModel"
  | "AdRequestModel"
  | "AdAttemptModel"
  | "runRaidIntervention"
  | "raidIntervention"
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

export type MongoPlatformBundle = Pick<
  MongoContextValue,
  "logger" | "env" | "parseEnvNumber" | "requestContext" | "guildSettingsBus" | "waitForMongoReady"
>;

export type MongoGuildCacheBundle = Pick<
  MongoContextValue,
  "getGuildSettings" | "invalidateGuildCache" | "cleanGuildCache" | "getGuildCacheSize"
>;

export type MongoOutboxStateBundle = Pick<MongoContextValue, "getOutboxPaused" | "setOutboxPaused">;

export interface MongoContextBundles {
  repositories: MongoRepositoriesBundle;
  locks: MongoLocksBundle;
  migrations: MongoMigrationsBundle;
  snapshots: MongoSnapshotsBundle;
  administration: MongoAdministrationBundle;
  platform: MongoPlatformBundle;
  guildCache: MongoGuildCacheBundle;
  outboxState: MongoOutboxStateBundle;
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
    PermissionRequestModel: context.PermissionRequestModel,
    ProtectedResourceModel: context.ProtectedResourceModel,
    WebhookSnapshotModel: context.WebhookSnapshotModel,
    MassModerationModel: context.MassModerationModel,
    RaidSnapshotModel: context.RaidSnapshotModel,
    AuditEntryClaimModel: context.AuditEntryClaimModel,
    RaidIncidentModel: context.RaidIncidentModel,
    AdRequestModel: context.AdRequestModel,
    AdAttemptModel: context.AdAttemptModel,
    runRaidIntervention: context.runRaidIntervention,
    raidIntervention: context.raidIntervention,
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

export function selectMongoPlatform(context: MongoPlatformBundle): MongoPlatformBundle {
  return {
    logger: context.logger,
    env: context.env,
    parseEnvNumber: context.parseEnvNumber,
    requestContext: context.requestContext,
    guildSettingsBus: context.guildSettingsBus,
    waitForMongoReady: context.waitForMongoReady
  };
}

export function selectMongoGuildCache(context: MongoGuildCacheBundle): MongoGuildCacheBundle {
  return {
    getGuildSettings: context.getGuildSettings,
    invalidateGuildCache: context.invalidateGuildCache,
    cleanGuildCache: context.cleanGuildCache,
    getGuildCacheSize: context.getGuildCacheSize
  };
}

export function selectMongoOutboxState(context: MongoOutboxStateBundle): MongoOutboxStateBundle {
  return {
    getOutboxPaused: context.getOutboxPaused,
    setOutboxPaused: context.setOutboxPaused
  };
}

export function composeMongoContextBundles(context: MongoContextValue): MongoContextBundles {
  return {
    repositories: selectMongoRepositories(context),
    locks: selectMongoLocks(context),
    migrations: selectMongoMigrations(context),
    snapshots: selectMongoSnapshots(context),
    administration: selectMongoAdministration(context),
    platform: selectMongoPlatform(context),
    guildCache: selectMongoGuildCache(context),
    outboxState: selectMongoOutboxState(context)
  };
}
