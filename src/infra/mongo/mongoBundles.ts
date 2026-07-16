"use strict";

export type MongoRepositoryBundle = {
  GuildModel: unknown;
  GuildAuditLogModel: unknown;
  NotificationOutboxModel: unknown;
  NotificationHistoryModel: unknown;
  NotificationDeadLetterReplayModel: unknown;
  FeedbackReportModel: unknown;
};

export type MongoLockBundle = {
  JobLockModel: unknown;
  acquireDbLock: unknown;
  renewDbLock: unknown;
  releaseDbLock: unknown;
  activeLocks: unknown;
};

export type MongoSnapshotBundle = {
  FetchSnapshotModel: unknown;
  PlayerCountSnapshotModel: unknown;
  PlayerCountHistoryModel: unknown;
  PlayerCountRecordModel: unknown;
  saveFetchSnapshot: unknown;
  loadFetchSnapshot: unknown;
  loadDealsFetchSnapshots: unknown;
};

export type MongoAdministrationBundle = {
  GuildConfigBackupModel: unknown;
  GuildDeadLetterModel: unknown;
  OperationJournalModel: unknown;
  runMigrations: unknown;
};

export interface MongoBundles {
  repositories: MongoRepositoryBundle;
  locks: MongoLockBundle;
  snapshots: MongoSnapshotBundle;
  administration: MongoAdministrationBundle;
}

export function createMongoBundles(source: Record<string, unknown>): MongoBundles {
  return {
    repositories: {
      GuildModel: source.GuildModel,
      GuildAuditLogModel: source.GuildAuditLogModel,
      NotificationOutboxModel: source.NotificationOutboxModel,
      NotificationHistoryModel: source.NotificationHistoryModel,
      NotificationDeadLetterReplayModel: source.NotificationDeadLetterReplayModel,
      FeedbackReportModel: source.FeedbackReportModel
    },
    locks: {
      JobLockModel: source.JobLockModel,
      acquireDbLock: source.acquireDbLock,
      renewDbLock: source.renewDbLock,
      releaseDbLock: source.releaseDbLock,
      activeLocks: source.activeLocks
    },
    snapshots: {
      FetchSnapshotModel: source.FetchSnapshotModel,
      PlayerCountSnapshotModel: source.PlayerCountSnapshotModel,
      PlayerCountHistoryModel: source.PlayerCountHistoryModel,
      PlayerCountRecordModel: source.PlayerCountRecordModel,
      saveFetchSnapshot: source.saveFetchSnapshot,
      loadFetchSnapshot: source.loadFetchSnapshot,
      loadDealsFetchSnapshots: source.loadDealsFetchSnapshots
    },
    administration: {
      GuildConfigBackupModel: source.GuildConfigBackupModel,
      GuildDeadLetterModel: source.GuildDeadLetterModel,
      OperationJournalModel: source.OperationJournalModel,
      runMigrations: source.runMigrations
    }
  };
}
