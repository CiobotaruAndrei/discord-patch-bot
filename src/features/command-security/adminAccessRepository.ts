"use strict";

import { recordServerAuditEntry, type GuildAuditLogModelLike } from "../admin-records/auditLogRepository.js";
import { sequentialRunner, type TransactionRunner } from "../../shared/transactionPort.js";
import type { ServerAuditLogEntry } from "../admin-records/adminRecordsTypes.js";
import type { AdminCommandAccessConfig } from "./adminCommandAccessScope.js";
import type { AdminScopeId } from "./adminScopeIds.js";
import type { GuildAdminAccessDoc, GuildAdminAccessQuery } from "./adminGuardContracts.js";

export interface AdminAccessReadModelLike {
  findOne?(filter: object): GuildAdminAccessQuery | Promise<GuildAdminAccessDoc | null>;
}

function hasLean(result: GuildAdminAccessQuery | Promise<GuildAdminAccessDoc | null>): result is GuildAdminAccessQuery {
  return "lean" in result && typeof result.lean === "function";
}

export async function loadAdminAccessDoc(GuildModel: AdminAccessReadModelLike, guildId: string): Promise<GuildAdminAccessDoc | null> {
  if (typeof GuildModel.findOne !== "function") return null;
  const result = GuildModel.findOne!({ _id: guildId });
  const doc = hasLean(result) ? await result.lean() : await result;
  return doc || null;
}

export interface AdminAccessWriteModelLike {
  updateOne(filter: object, update: object, options?: object): Promise<unknown>;
}

export async function saveAdminAccessRule(
  GuildModel: AdminAccessWriteModelLike,
  GuildAuditLogModel: GuildAuditLogModelLike,
  guildId: string,
  input: {
    scope: AdminScopeId;
    access: AdminCommandAccessConfig & { updatedBy: string; updatedAt: Date };
    legacyKeys: readonly string[];
    audit: Omit<ServerAuditLogEntry, "serverId" | "at">;
    operationId?: string;
  },
  runner?: TransactionRunner
): Promise<void> {
  const { scope, access, legacyKeys, audit, operationId } = input;
  const ruleUpdate: Record<string, unknown> = scope === "global"
    ? { $set: { adminCommandAccess: access } }
    : legacyKeys.length
      ? {
          $set: { [`adminCommandAccessByCommand.${scope}`]: access },
          $unset: Object.fromEntries(legacyKeys.map(key => [`adminCommandAccessByCommand.${key}`, ""]))
        }
      : { $set: { [`adminCommandAccessByCommand.${scope}`]: access } };
  const run = runner ?? sequentialRunner;
  await run.atomic("admin-access-save", async session => {
    const options = session ? { session } : undefined;
    await GuildModel.updateOne({ _id: guildId }, ruleUpdate, { upsert: true, ...(options ?? {}) });
    await recordServerAuditEntry(GuildAuditLogModel, guildId, audit, operationId, options);
  });
}

export async function deleteAdminAccessRule(
  GuildModel: AdminAccessWriteModelLike,
  GuildAuditLogModel: GuildAuditLogModelLike,
  guildId: string,
  input: {
    scope: string;
    lookupKeys: readonly string[];
    audit: Omit<ServerAuditLogEntry, "serverId" | "at">;
    operationId?: string;
  },
  runner?: TransactionRunner
): Promise<void> {
  const { scope, lookupKeys, audit, operationId } = input;
  const ruleUpdate: Record<string, unknown> = scope === "global"
    ? { $set: { adminCommandAccess: null } }
    : { $unset: Object.fromEntries(lookupKeys.map(key => [`adminCommandAccessByCommand.${key}`, ""])) };
  const run = runner ?? sequentialRunner;
  await run.atomic("admin-access-delete", async session => {
    const options = session ? { session } : undefined;
    await GuildModel.updateOne({ _id: guildId }, ruleUpdate, { upsert: true, ...(options ?? {}) });
    await recordServerAuditEntry(GuildAuditLogModel, guildId, audit, operationId, options);
  });
}
