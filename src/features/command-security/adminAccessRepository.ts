"use strict";

import { buildServerAuditPush } from "../admin-records/auditLogRepository";
import type { ServerAuditLogEntry } from "../../types";
import type { AdminCommandAccessConfig } from "./adminCommandAccessScope";
import type { GuildAdminAccessDoc, GuildAdminAccessQuery } from "./adminGuardContracts";

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
  guildId: string,
  input: {
    scope: string;
    access: AdminCommandAccessConfig & { updatedBy: string; updatedAt: Date };
    legacyKeys: readonly string[];
    audit: Omit<ServerAuditLogEntry, "serverId" | "at">;
  }
): Promise<void> {
  const { scope, access, legacyKeys, audit } = input;
  const ruleUpdate: Record<string, unknown> = scope === "global"
    ? { $set: { adminCommandAccess: access } }
    : legacyKeys.length
      ? {
          $set: { [`adminCommandAccessByCommand.${scope}`]: access },
          $unset: Object.fromEntries(legacyKeys.map(key => [`adminCommandAccessByCommand.${key}`, ""]))
        }
      : { $set: { [`adminCommandAccessByCommand.${scope}`]: access } };
  await GuildModel.updateOne(
    { _id: guildId },
    { ...ruleUpdate, $push: buildServerAuditPush(guildId, audit) },
    { upsert: true }
  );
}

export async function deleteAdminAccessRule(
  GuildModel: AdminAccessWriteModelLike,
  guildId: string,
  input: {
    scope: string;
    lookupKeys: readonly string[];
    audit: Omit<ServerAuditLogEntry, "serverId" | "at">;
  }
): Promise<void> {
  const { scope, lookupKeys, audit } = input;
  const ruleUpdate: Record<string, unknown> = scope === "global"
    ? { $set: { adminCommandAccess: null } }
    : { $unset: Object.fromEntries(lookupKeys.map(key => [`adminCommandAccessByCommand.${key}`, ""])) };
  await GuildModel.updateOne(
    { _id: guildId },
    { ...ruleUpdate, $push: buildServerAuditPush(guildId, audit) },
    { upsert: true }
  );
}
