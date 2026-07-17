"use strict";

import { AuditLogEvent, PermissionFlagsBits } from "discord.js";
import { recordServerAuditEntry, type GuildAuditLogModelLike } from "../admin-records/auditLogRepository.js";

type PermissionSet = { has(flag: bigint): boolean; bitfield?: bigint };
type RoleLike = {
  id: string;
  name?: string;
  managed?: boolean;
  permissions: PermissionSet;
  guild: GuildLike;
  setPermissions?(permissions: bigint, reason?: string): Promise<unknown>;
};
type OverwriteLike = { id: string; allow: PermissionSet; deny: PermissionSet };
type OverwriteCollection = { values(): IterableIterator<OverwriteLike> };
type ChannelLike = {
  id: string;
  name?: string;
  guild?: GuildLike | null;
  permissionOverwrites?: {
    cache?: OverwriteCollection;
    edit?(targetId: string, permissions: Record<string, boolean | null>, options?: { reason?: string }): Promise<unknown>;
  };
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
  wait?: (ms: number) => Promise<void>;
}

const AUDIT_LOG_MATCH_WINDOW_MS = 60_000;
const AUDIT_LOG_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000];

const PROTECTED_PERMISSIONS = [
  { flag: PermissionFlagsBits.Administrator, label: "Administrator" },
  { flag: PermissionFlagsBits.BanMembers, label: "Ban Members" },
  { flag: PermissionFlagsBits.KickMembers, label: "Kick Members" },
  { flag: PermissionFlagsBits.ModerateMembers, label: "Moderate Members" },
  { flag: PermissionFlagsBits.ManageWebhooks, label: "Manage Webhooks" }
] as const;

type ProtectedPermission = (typeof PROTECTED_PERMISSIONS)[number];

const CHANNEL_PROTECTED_PERMISSIONS = [
  { flag: PermissionFlagsBits.ManageWebhooks, option: "ManageWebhooks" },
  { flag: PermissionFlagsBits.ManageRoles, option: "ManageRoles" }
] as const;

function hasProtectedPermission(permissions: PermissionSet): boolean {
  return PROTECTED_PERMISSIONS.some(({ flag }) => permissions.has(flag));
}

function grantedProtectedPermissions(previous: PermissionSet, next: PermissionSet): ProtectedPermission[] {
  return PROTECTED_PERMISSIONS.filter(({ flag }) => !previous.has(flag) && next.has(flag));
}

function protectedMask(granted: readonly ProtectedPermission[]): bigint {
  return granted.reduce((mask, { flag }) => mask | flag, 0n);
}

function requireBitfield(permissions: PermissionSet, subject: string): bigint {
  if (typeof permissions.bitfield !== "bigint") {
    throw new Error(`Bitfield-ul permisiunilor pentru ${subject} nu este disponibil pentru restaurarea stricta.`);
  }
  return permissions.bitfield;
}

async function auditActor(guild: GuildLike, type: AuditLogEvent, targetId: string, eventTime: number): Promise<string | null> {
  const logs = await guild.fetchAuditLogs?.({ type, limit: 6 });
  const entries = logs?.entries ? [...logs.entries.values()] : [];
  const match = entries.find(entry =>
    entry.target?.id === targetId
    && typeof entry.createdTimestamp === "number"
    && Math.abs(eventTime - entry.createdTimestamp) <= AUDIT_LOG_MATCH_WINDOW_MS
  );
  return match?.executor?.id ?? null;
}

async function actorWithRetry(
  lookup: () => Promise<string | null>,
  wait: (ms: number) => Promise<void>
): Promise<string | null> {
  let actorId = await lookup();
  for (const delayMs of AUDIT_LOG_RETRY_DELAYS_MS) {
    if (actorId) return actorId;
    await wait(delayMs);
    actorId = await lookup();
  }
  return actorId;
}

function roles(member: MemberLike): RoleLike[] {
  return member.roles?.cache ? [...member.roles.cache.values()] : [];
}

function overwrites(channel: ChannelLike): OverwriteLike[] {
  return channel.permissionOverwrites?.cache ? [...channel.permissionOverwrites.cache.values()] : [];
}

async function channelOverwriteActor(guild: GuildLike, channelId: string, eventTime: number): Promise<string | null> {
  for (const type of [AuditLogEvent.ChannelOverwriteUpdate, AuditLogEvent.ChannelOverwriteCreate]) {
    const actorId = await auditActor(guild, type, channelId, eventTime);
    if (actorId) return actorId;
  }
  return null;
}

export function createPermissionDelegationRuntime(deps: PermissionDelegationRuntimeDeps) {
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));

  async function handleRoleUpdate(previous: RoleLike, next: RoleLike): Promise<void> {
    const granted = grantedProtectedPermissions(previous.permissions, next.permissions);
    if (!granted.length) return;
    const eventTime = now();
    const actorId = await actorWithRetry(() => auditActor(next.guild, AuditLogEvent.RoleUpdate, next.id, eventTime), wait);
    if (actorId && actorId === next.guild.ownerId) return;
    if (!next.setPermissions) throw new Error(`Permisiunile rolului ${next.id} nu pot fi restaurate.`);
    const nextBits = requireBitfield(next.permissions, `rolul ${next.id}`);
    await next.setPermissions(nextBits & ~protectedMask(granted), "Protectie anti-delegare: numai ownerul poate acorda permisiuni sensibile");
    deps.metrics && (deps.metrics.permissionDelegationsReverted = (deps.metrics.permissionDelegationsReverted ?? 0) + 1);
    await recordServerAuditEntry(deps.GuildAuditLogModel, next.guild.id, {
      userId: actorId ?? "",
      action: "protected-role-permissions-reverted",
      details: `roleId=${next.id}; roleName=${next.name ?? ""}; removed=${granted.map(({ label }) => label).join("+")}`
    });
    await deps.adminAlert(
      "security:permission-delegation",
      "Delegare neautorizata de permisiuni restaurata",
      `Rol ${next.name ?? next.id}; permisiuni eliminate: ${granted.map(({ label }) => label).join(", ")}; restul modificarilor raman; actor ${actorId ?? "nedetectat"}`,
      next.guild.id
    );
  }

  async function handleGuildMemberUpdate(previous: MemberLike, next: MemberLike): Promise<void> {
    const previousRoleIds = new Set(roles(previous).map(role => role.id));
    const addedProtected = roles(next).filter(role => !previousRoleIds.has(role.id) && hasProtectedPermission(role.permissions));
    if (!addedProtected.length) return;
    const eventTime = now();
    const actorId = await actorWithRetry(() => auditActor(next.guild, AuditLogEvent.MemberRoleUpdate, next.id, eventTime), wait);
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

  async function handleRoleCreate(role: RoleLike): Promise<void> {
    const grantedAtCreate = PROTECTED_PERMISSIONS.filter(({ flag }) => role.permissions.has(flag));
    if (!grantedAtCreate.length) return;
    const eventTime = now();
    const actorId = await actorWithRetry(() => auditActor(role.guild, AuditLogEvent.RoleCreate, role.id, eventTime), wait);
    if (actorId && actorId === role.guild.ownerId) return;
    if (role.managed === true) {
      await recordServerAuditEntry(deps.GuildAuditLogModel, role.guild.id, {
        userId: actorId ?? "",
        action: "protected-managed-role-created-alerted",
        details: `roleId=${role.id}; roleName=${role.name ?? ""}; managed=true`
      });
      await deps.adminAlert(
        "security:permission-delegation",
        "Rol gestionat de integrare creat cu permisiuni sensibile",
        `Rol ${role.name ?? role.id} (gestionat de integrare/bot, permisiunile lui nu se restaureaza automat); actor ${actorId ?? "nedetectat"}; verificare owner necesara`,
        role.guild.id
      );
      return;
    }
    if (!role.setPermissions) throw new Error(`Permisiunile sensibile ale rolului nou ${role.id} nu pot fi eliminate.`);
    const roleBits = requireBitfield(role.permissions, `rolul nou ${role.id}`);
    await role.setPermissions(roleBits & ~protectedMask(grantedAtCreate), "Protectie anti-delegare: numai ownerul poate crea roluri cu permisiuni sensibile");
    deps.metrics && (deps.metrics.permissionDelegationsReverted = (deps.metrics.permissionDelegationsReverted ?? 0) + 1);
    await recordServerAuditEntry(deps.GuildAuditLogModel, role.guild.id, {
      userId: actorId ?? "",
      action: "protected-role-create-reverted",
      details: `roleId=${role.id}; roleName=${role.name ?? ""}; removed=${grantedAtCreate.map(({ label }) => label).join("+")}`
    });
    await deps.adminAlert(
      "security:permission-delegation",
      "Rol nou creat cu permisiuni sensibile; permisiunile sensibile au fost eliminate",
      `Rol ${role.name ?? role.id}; permisiuni eliminate: ${grantedAtCreate.map(({ label }) => label).join(", ")}; permisiunile neprotejate raman; actor ${actorId ?? "nedetectat"}`,
      role.guild.id
    );
  }

  async function handleChannelUpdate(previous: ChannelLike, next: ChannelLike): Promise<void> {
    const guild = next.guild;
    if (!guild?.id) return;
    const previousByTarget = new Map(overwrites(previous).map(overwrite => [overwrite.id, overwrite]));
    const violations = overwrites(next)
      .map(overwrite => ({
        overwrite,
        granted: CHANNEL_PROTECTED_PERMISSIONS.filter(({ flag }) => {
          const before = previousByTarget.get(overwrite.id);
          return overwrite.allow.has(flag) && !(before?.allow.has(flag) ?? false);
        })
      }))
      .filter(entry => entry.granted.length > 0);
    if (!violations.length) return;
    const eventTime = now();
    const actorId = await actorWithRetry(() => channelOverwriteActor(guild, next.id, eventTime), wait);
    if (actorId && actorId === guild.ownerId) return;
    const edit = next.permissionOverwrites?.edit;
    if (!edit) throw new Error(`Overwrite-urile canalului ${next.id} nu pot fi restaurate.`);
    for (const { overwrite, granted } of violations) {
      const before = previousByTarget.get(overwrite.id);
      const restore: Record<string, boolean | null> = {};
      for (const { flag, option } of granted) {
        restore[option] = before?.deny.has(flag) === true ? false : null;
      }
      await edit(overwrite.id, restore, { reason: "Protectie anti-delegare: numai ownerul poate acorda permisiuni sensibile prin overwrite de canal" });
    }
    deps.metrics && (deps.metrics.permissionDelegationsReverted = (deps.metrics.permissionDelegationsReverted ?? 0) + violations.length);
    await recordServerAuditEntry(deps.GuildAuditLogModel, guild.id, {
      userId: actorId ?? "",
      action: "protected-channel-overwrite-reverted",
      details: `channelId=${next.id}; targets=${violations.map(entry => `${entry.overwrite.id}:${entry.granted.map(item => item.option).join("+")}`).join(",")}`
    });
    await deps.adminAlert(
      "security:permission-delegation",
      "Overwrite de canal cu permisiuni sensibile restaurat",
      `Canal ${next.name ?? next.id}; tinte ${violations.map(entry => entry.overwrite.id).join(", ")}; actor ${actorId ?? "nedetectat"}`,
      guild.id
    );
  }

  return Object.freeze({ handleRoleUpdate, handleGuildMemberUpdate, handleRoleCreate, handleChannelUpdate });
}

export default { createPermissionDelegationRuntime };
