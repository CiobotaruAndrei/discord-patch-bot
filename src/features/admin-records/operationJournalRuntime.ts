import type { TransactionRunner } from "../../shared/transactionPort.js";
import type { CurrencyCode } from "../../types.js";
import type { ConfigBackupRecord, ServerAuditLogEntry } from "./adminRecordsTypes.js";
import { createOperationJournal, type OperationJournal, type OperationJournalModelLike } from "../../shared/operationJournalEngine.js";
import { resetGuildConfigurationWithAudit, type GuildConfigWriteModelLike } from "../guild-config/guildConfigRepository.js";
import { deleteConfigBackupWithAudit, loadConfigBackupWithAudit, saveConfigBackupRecord, type ConfigBackupModelLike } from "./configBackupRepository.js";
import { recordServerAuditEntry, type GuildAuditLogModelLike } from "./auditLogRepository.js";
import type { YoutubeErrorModelLike } from "../youtube/youtubeErrorsRepository.js";
import type { DeadLetterModelLike } from "../notifications/deadLetterRepository.js";
import { deleteAdminAccessRule, saveAdminAccessRule } from "../command-security/adminAccessRepository.js";
import type { AdminCommandAccessConfig } from "../command-security/adminCommandAccessScope.js";
import { isAdminScopeId, type AdminScopeId } from "../command-security/adminScopeIds.js";
import { executorsFrom, schemaVersionsFrom, type OperationCodecTable } from "./operationCodec.js";

type JournalLogger = (level: string, context: string, message: string, meta?: unknown) => void;

export const RESET_CONFIG_KIND = "reset-config";
export const BACKUP_LOAD_KIND = "backup-load";
export const BACKUP_SAVE_KIND = "backup-save";
export const BACKUP_DELETE_KIND = "backup-delete";
export const ADMIN_ACCESS_SAVE_KIND = "admin-access-save";
export const ADMIN_ACCESS_DELETE_KIND = "admin-access-delete";
export const OPERATION_PAYLOAD_SCHEMA_VERSION = 1;

export type OperationKindMap = {
  [RESET_CONFIG_KIND]: ResetConfigPayload;
  [BACKUP_LOAD_KIND]: BackupLoadPayload;
  [BACKUP_SAVE_KIND]: BackupSavePayload;
  [BACKUP_DELETE_KIND]: BackupDeletePayload;
  [ADMIN_ACCESS_SAVE_KIND]: AdminAccessSavePayload;
  [ADMIN_ACCESS_DELETE_KIND]: AdminAccessDeletePayload;
};

const DISCORD_EPOCH_MS = 1420070400000;

export function journalResourceVersion(interactionId?: string): string {
  if (interactionId && /^\d+$/.test(interactionId)) {
    return interactionId.padStart(20, "0");
  }
  const syntheticSnowflake = BigInt(Math.max(0, Date.now() - DISCORD_EPOCH_MS)) << 22n;
  return syntheticSnowflake.toString().padStart(20, "0");
}

interface AuditPayload {
  userId: string;
  action: string;
  details: string;
}

export interface ResetConfigPayload {
  guildId: string;
  defaultCurrency: CurrencyCode;
  audit: Omit<ServerAuditLogEntry, "serverId" | "at">;
}

export interface BackupLoadPayload {
  guildId: string;
  backup: ConfigBackupRecord;
  audit: AuditPayload;
}

export interface BackupSavePayload extends BackupLoadPayload {}

export interface BackupDeletePayload {
  guildId: string;
  name: string;
  audit: AuditPayload;
}

export interface AdminAccessSavePayload {
  guildId: string;
  scope: AdminScopeId;
  access: AdminCommandAccessConfig & { updatedBy: string; updatedAt: Date };
  legacyKeys: string[];
  audit: AuditPayload;
}

export interface AdminAccessDeletePayload {
  guildId: string;
  scope: string;
  lookupKeys: string[];
  audit: AuditPayload;
}

interface ReplayPayloadModelLike {
  deleteMany(filter: Record<string, unknown>): Promise<unknown>;
}

export interface OperationJournalRuntimeDeps {
  OperationJournalModel: OperationJournalModelLike;
  GuildModel: GuildConfigWriteModelLike;
  GuildAuditLogModel: GuildAuditLogModelLike;
  GuildConfigBackupModel?: ConfigBackupModelLike;
  GuildYoutubeErrorModel?: Pick<YoutubeErrorModelLike, "deleteMany">;
  GuildDeadLetterModel?: Pick<DeadLetterModelLike, "deleteMany">;
  NotificationDeadLetterReplayModel?: ReplayPayloadModelLike;
  transactionRunner?: TransactionRunner;
  logger: JournalLogger;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? Object.fromEntries(Object.entries(value)) : null;
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(item => typeof item === "string") ? value : null;
}

function auditPayload(value: unknown): AuditPayload | null {
  const candidate = record(value);
  if (!candidate || typeof candidate.userId !== "string" || typeof candidate.action !== "string" || typeof candidate.details !== "string") return null;
  return { userId: candidate.userId, action: candidate.action, details: candidate.details };
}

function resetPayload(value: unknown): ResetConfigPayload | null {
  const candidate = record(value);
  const audit = candidate ? auditPayload(candidate.audit) : null;
  if (!candidate || typeof candidate.guildId !== "string" || !isCurrencyCode(candidate.defaultCurrency) || !audit) return null;
  return { guildId: candidate.guildId, defaultCurrency: candidate.defaultCurrency, audit };
}

function isCurrencyCode(value: unknown): value is CurrencyCode {
  return value === "USD" || value === "EUR" || value === "GBP" || value === "RON";
}

function backupRecord(value: unknown): ConfigBackupRecord | null {
  const candidate = record(value);
  const snapshot = candidate ? record(candidate.snapshot) : null;
  if (!candidate || typeof candidate.name !== "string" || typeof candidate.createdBy !== "string" || !snapshot) return null;
  const createdAt = candidate.createdAt instanceof Date ? candidate.createdAt : new Date(String(candidate.createdAt));
  if (Number.isNaN(createdAt.getTime())) return null;
  return { name: candidate.name, createdBy: candidate.createdBy, createdAt, snapshot };
}

function backupLoadPayload(value: unknown): BackupLoadPayload | null {
  const candidate = record(value);
  const backup = candidate ? backupRecord(candidate.backup) : null;
  const audit = candidate ? auditPayload(candidate.audit) : null;
  if (!candidate || typeof candidate.guildId !== "string" || !backup || !audit) return null;
  return { guildId: candidate.guildId, backup, audit };
}

function backupDeletePayload(value: unknown): BackupDeletePayload | null {
  const candidate = record(value);
  const audit = candidate ? auditPayload(candidate.audit) : null;
  if (!candidate || typeof candidate.guildId !== "string" || typeof candidate.name !== "string" || !audit) return null;
  return { guildId: candidate.guildId, name: candidate.name, audit };
}

function accessConfig(value: unknown): AdminAccessSavePayload["access"] | null {
  const candidate = record(value);
  if (!candidate || (candidate.mode !== "role" && candidate.mode !== "role-or-higher") || typeof candidate.roleId !== "string" || typeof candidate.updatedBy !== "string") return null;
  const updatedAt = candidate.updatedAt instanceof Date ? candidate.updatedAt : new Date(String(candidate.updatedAt));
  if (Number.isNaN(updatedAt.getTime())) return null;
  return { mode: candidate.mode, roleId: candidate.roleId, updatedBy: candidate.updatedBy, updatedAt };
}

function adminAccessSavePayload(value: unknown): AdminAccessSavePayload | null {
  const candidate = record(value);
  const access = candidate ? accessConfig(candidate.access) : null;
  const legacyKeys = candidate ? stringArray(candidate.legacyKeys) : null;
  const audit = candidate ? auditPayload(candidate.audit) : null;
  if (!candidate || typeof candidate.guildId !== "string" || typeof candidate.scope !== "string" || !isAdminScopeId(candidate.scope) || !access || !legacyKeys || !audit) return null;
  return { guildId: candidate.guildId, scope: candidate.scope, access, legacyKeys, audit };
}

function adminAccessDeletePayload(value: unknown): AdminAccessDeletePayload | null {
  const candidate = record(value);
  const lookupKeys = candidate ? stringArray(candidate.lookupKeys) : null;
  const audit = candidate ? auditPayload(candidate.audit) : null;
  if (!candidate || typeof candidate.guildId !== "string" || typeof candidate.scope !== "string" || !lookupKeys || !audit) return null;
  return { guildId: candidate.guildId, scope: candidate.scope, lookupKeys, audit };
}

function requiredBackupModel(model: ConfigBackupModelLike | undefined): ConfigBackupModelLike {
  if (!model) throw new Error("operationJournal: GuildConfigBackupModel lipseste pentru operatia de backup");
  return model;
}

function requiredYoutubeErrorModel(model: Pick<YoutubeErrorModelLike, "deleteMany"> | undefined): Pick<YoutubeErrorModelLike, "deleteMany"> {
  if (!model) throw new Error("operationJournal: GuildYoutubeErrorModel lipseste pentru reset-config");
  return model;
}

function requiredDeadLetterModel(model: Pick<DeadLetterModelLike, "deleteMany"> | undefined): Pick<DeadLetterModelLike, "deleteMany"> {
  if (!model) throw new Error("operationJournal: GuildDeadLetterModel lipseste pentru reset-config");
  return model;
}

export function createOperationJournalRuntime(deps: OperationJournalRuntimeDeps): OperationJournal<OperationKindMap> {
  const codecs: OperationCodecTable<OperationKindMap> = {
    [RESET_CONFIG_KIND]: {
      schemaVersion: OPERATION_PAYLOAD_SCHEMA_VERSION,
      decode: resetPayload,
      resourceKey: payload => payload.guildId,
      execute: async (payload, operationId) => {
        await resetGuildConfigurationWithAudit(
          deps.GuildModel, deps.GuildAuditLogModel, requiredYoutubeErrorModel(deps.GuildYoutubeErrorModel), requiredDeadLetterModel(deps.GuildDeadLetterModel),
          payload.guildId, payload.defaultCurrency, payload.audit, operationId, deps.transactionRunner
        );
        if (deps.NotificationDeadLetterReplayModel) {
          await deps.NotificationDeadLetterReplayModel.deleteMany({ guildId: payload.guildId });
        }
      }
    },
    [BACKUP_LOAD_KIND]: {
      schemaVersion: OPERATION_PAYLOAD_SCHEMA_VERSION,
      decode: backupLoadPayload,
      resourceKey: payload => `${payload.guildId}:${payload.backup.name}`,
      execute: async (payload, operationId) => {
        await loadConfigBackupWithAudit(deps.GuildModel, deps.GuildAuditLogModel, payload.guildId, payload.backup, payload.audit, operationId);
      }
    },
    [BACKUP_SAVE_KIND]: {
      schemaVersion: OPERATION_PAYLOAD_SCHEMA_VERSION,
      decode: backupLoadPayload,
      resourceKey: payload => `${payload.guildId}:${payload.backup.name}`,
      execute: async (payload, operationId) => {
        await saveConfigBackupRecord(requiredBackupModel(deps.GuildConfigBackupModel), payload.guildId, payload.backup);
        await recordServerAuditEntry(deps.GuildAuditLogModel, payload.guildId, payload.audit, operationId);
      }
    },
    [BACKUP_DELETE_KIND]: {
      schemaVersion: OPERATION_PAYLOAD_SCHEMA_VERSION,
      decode: backupDeletePayload,
      resourceKey: payload => `${payload.guildId}:${payload.name}`,
      execute: async (payload, operationId) => {
        await deleteConfigBackupWithAudit(requiredBackupModel(deps.GuildConfigBackupModel), deps.GuildAuditLogModel, payload.guildId, payload.name, payload.audit, operationId);
      }
    },
    [ADMIN_ACCESS_SAVE_KIND]: {
      schemaVersion: OPERATION_PAYLOAD_SCHEMA_VERSION,
      decode: adminAccessSavePayload,
      resourceKey: payload => `${payload.guildId}:${payload.scope}`,
      execute: async (payload, operationId) => {
        await saveAdminAccessRule(deps.GuildModel, deps.GuildAuditLogModel, payload.guildId, { ...payload, operationId });
      }
    },
    [ADMIN_ACCESS_DELETE_KIND]: {
      schemaVersion: OPERATION_PAYLOAD_SCHEMA_VERSION,
      decode: adminAccessDeletePayload,
      resourceKey: payload => `${payload.guildId}:${payload.scope}`,
      execute: async (payload, operationId) => {
        await deleteAdminAccessRule(deps.GuildModel, deps.GuildAuditLogModel, payload.guildId, { ...payload, operationId });
      }
    }
  };
  return createOperationJournal<OperationKindMap>({
    JournalModel: deps.OperationJournalModel,
    logger: deps.logger,
    executors: executorsFrom(codecs),
    schemaVersions: schemaVersionsFrom(codecs)
  });
}
