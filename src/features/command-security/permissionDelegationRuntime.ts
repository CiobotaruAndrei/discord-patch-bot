"use strict";

import { AuditLogEvent, PermissionFlagsBits } from "discord.js";
import { recordServerAuditEntry, type GuildAuditLogModelLike } from "../admin-records/auditLogRepository.js";

type PermissionSet = { has(flag: bigint): boolean };
type RoleLike = {
  id: string;
  name?: string;
  permissions: PermissionSet;
  guild: GuildLike;
  setPermissions?(permissions: PermissionSet, reason?: string): Promise<unknown>;
};
type RoleCollection = { values(): IterableIterator<RoleLike> };
type MemberLike = {
  id: string;
  guild: GuildLike;
  roles?: {
    cache?: RoleCollection;
    remove?(roleId: string, reason?: string): Promise<unknown>;
  };
};
type AuditEntry = {
  target?: { id?: string } | null;
  executor?: { id?: string } | null;
  createdTimestamp?: number;
};
type GuildLike = {
  id: string;
  ownerId?: string;
  fetchAuditLogs?(options: { type: AuditLogEvent; limit: number }): Promise<{ entries?: { values(): IterableIterator<AuditEntry> } }>;
};
type DelegationMetrics = { permissionDelegationsReverted?: number };

export interface PermissionDelegationRuntimeDeps {
  GuildAuditLogModel: GuildAuditLogModelLike;
  adminAlert(kind: string, title: string, body: string, guildId?: string): Promise<unknown>;
  metrics?: DelegationMetrics;
  now?: () => number;
}

const PROTECTED_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ManageWebhooks
] as const;

function hasProtectedPermission(permissions: PermissionSet): boolean {
  return PROTECTED_PERMISSIONS.some(permission => permissions.has(permission));
}

function newlyGrantedProtectedPermission(previous: PermissionSet, next: PermissionSet): boolean {
  return PROTECTED_PERMISSIONS.some(permission => !previous.has(permission) && next.has(permission));
}

async function auditActor(guild: GuildLike, type: AuditLogEvent, targetId: string, now: number): Promise<string | null> {
  const logs = await guild.fetchAuditLogs?.({ type, limit: 6 });
  const entries = logs?.entries ? [...logs.entries.values()] : [];
  const match = entries.find(entry =>
    entry.target?.id === targetId
    && typeof entry.createdTimestamp === "number"
    && Math.abs(now - entry.createdTimestamp) <= 20_000
  );
  return match?.executor?.id ?? null;
}

function roles(member: MemberLike): RoleLike[] {
  return member.roles?.cache ? [...member.roles.cache.values()] : [];
}

export function createPermissionDelegationRuntime(deps: PermissionDelegationRuntimeDeps) {
  const now = deps.now ?? Date.now;

  async function handleRoleUpdate(previous: RoleLike, next: RoleLike): Promise<void> {
    if (!newlyGrantedProtectedPermission(previous.permissions, next.permissions)) return;
    const actorId = await auditActor(next.guild, AuditLogEvent.RoleUpdate, next.id, now());
    if (actorId && actorId === next.guild.ownerId) return;
    if (!next.setPermissions) throw new Error(`Permisiunile rolului ${next.id} nu pot fi restaurate.`);
    await next.setPermissions(previous.permissions, "Protectie anti-delegare: numai ownerul poate acorda permisiuni sensibile");
    deps.metrics && (deps.metrics.permissionDelegationsReverted = (deps.metrics.permissionDelegationsReverted ?? 0) + 1);
    await recordServerAuditEntry(deps.GuildAuditLogModel, next.guild.id, {
      userId: actorId ?? "",
      action: "protected-role-permissions-reverted",
      details: `roleId=${next.id}; roleName=${next.name ?? ""}`
    });
    await deps.adminAlert(
      "security:permission-delegation",
      "Delegare neautorizata de permisiuni restaurata",
      `Rol ${next.name ?? next.id}; actor ${actorId ?? "nedetectat"}`,
      next.guild.id
    );
  }

  async function handleGuildMemberUpdate(previous: MemberLike, next: MemberLike): Promise<void> {
    const previousRoleIds = new Set(roles(previous).map(role => role.id));
    const addedProtected = roles(next).filter(role => !previousRoleIds.has(role.id) && hasProtectedPermission(role.permissions));
    if (!addedProtected.length) return;
    const actorId = await auditActor(next.guild, AuditLogEvent.MemberRoleUpdate, next.id, now());
    if (actorId && actorId === next.guild.ownerId) return;
    if (!next.roles?.remove) throw new Error(`Rolurile sensibile ale membrului ${next.id} nu pot fi restaurate.`);
    for (const role of addedProtected) {
      await next.roles.remove(role.id, "Protectie anti-delegare: numai ownerul poate acorda roluri sensibile");
    }
    deps.metrics && (deps.metrics.permissionDelegationsReverted = (deps.metrics.permissionDelegationsReverted ?? 0) + addedProtected.length);
    await recordServerAuditEntry(deps.GuildAuditLogModel, next.guild.id, {
      userId: actorId ?? "",
      action: "protected-member-roles-reverted",
      details: `memberId=${next.id}; roleIds=${addedProtected.map(role => role.id).join(",")}`
    });
    await deps.adminAlert(
      "security:permission-delegation",
      "Roluri sensibile acordate neautorizat si eliminate",
      `Membru ${next.id}; roluri ${addedProtected.map(role => role.name ?? role.id).join(", ")}; actor ${actorId ?? "nedetectat"}`,
      next.guild.id
    );
  }

  return Object.freeze({ handleRoleUpdate, handleGuildMemberUpdate });
}

export default { createPermissionDelegationRuntime };
