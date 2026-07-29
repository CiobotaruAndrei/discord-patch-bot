"use strict";

export interface WriteAcknowledgement {
  matchedCount?: number;
  modifiedCount?: number;
  upsertedCount?: number;
}

export interface DocumentCollection {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | readonly Record<string, unknown>[],
    options?: Record<string, unknown>
  ): Promise<unknown>;
  countDocuments(filter: Record<string, unknown>): Promise<number>;
}

export interface GuildConfigStore {
  guilds: DocumentCollection;
  readSettings(guildId: string): Promise<unknown>;
  invalidate(guildId: string): void;
  sweepExpired(): void;
  cachedCount(): number;
}

export interface NotificationStore {
  outbox: DocumentCollection;
  outboxSent: DocumentCollection;
  history: DocumentCollection;
  deadLetters: DocumentCollection;
  deadLetterReplays: DocumentCollection;
  seenDiscounts: DocumentCollection;
  seenUpdates: DocumentCollection;
  seenDlcs: DocumentCollection;
  seenYoutube: DocumentCollection;
}

export interface SecurityStore {
  newAccountAlerts: DocumentCollection;
  channelLockRecoveries: DocumentCollection;
  youtubeErrors: DocumentCollection;
}

export interface AuditStore {
  auditLog: DocumentCollection;
  configBackups: DocumentCollection;
  suggestedCommands: DocumentCollection;
}

export interface OperationStore {
  journal: DocumentCollection;
  jobLocks: DocumentCollection;
  acquire(jobName: string, ttlMs?: number): Promise<string | null>;
  renew(jobName: string, token: string, ttlMs?: number): Promise<boolean>;
  release(jobName: string, token: string): Promise<void>;
}

export interface MongoPorts {
  guildConfig: GuildConfigStore;
  notifications: NotificationStore;
  security: SecurityStore;
  audit: AuditStore;
  operations: OperationStore;
}

export const MONGO_PORT_NAMES = [
  "GuildConfigStore",
  "NotificationStore",
  "SecurityStore",
  "AuditStore",
  "OperationStore"
] as const;

export type MongoPortName = (typeof MONGO_PORT_NAMES)[number];
