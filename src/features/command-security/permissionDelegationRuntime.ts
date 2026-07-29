"use strict";

import type { PermissionDelegationMetricRecorder } from "../../shared/metricRecorderPorts.js";
import { AuditLogEvent, PermissionFlagsBits } from "discord.js";
import { recordServerAuditEntry, type GuildAuditLogModelLike } from "../admin-records/auditLogRepository.js";
import {
  recordBotObservationEvent,
  type BotObservationModelLike,
  type RecordedObservationEvent
} from "./botObservationRepository.js";

type PermissionSet = { has(flag: bigint): boolean; bitfield?: bigint };
type AuditEntryId = string | number;
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
  id?: AuditEntryId;
  target?: { id?: string } | null;
  executor?: { id?: string } | null;
  createdTimestamp?: number;
  extra?: { channel?: { id?: string } | null } | null;
};

interface AuditMatch {
  executorId: string | null;
  entryId: AuditEntryId | null;
}
type GuildLike = {
  id: string;
  ownerId?: string;
  fetchAuditLogs?(options: { type: AuditLogEvent; limit: number }): Promise<{ entries?: { values(): IterableIterator<AuditEntry> } }>;
};
type DelegationMetrics = { permissionDelegationsReverted?: number };

export interface PermissionDelegationRuntimeDeps {
  GuildModel?: BotObservationModelLike;
  GuildAuditLogModel: GuildAuditLogModelLike;
  adminAlert(kind: string, title: string, body: string, guildId?: string): Promise<unknown>;
  metrics?: PermissionDelegationMetricRecorder;
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
  { flag: PermissionFlagsBits.ManageWebhooks, option: "ManageWebhooks" }
] as const;

function explicitlyHas(bits: bigint, flag: bigint): boolean {
  return (bits & flag) === flag;
}

function explicitProtectedPermissions(bits: bigint): ProtectedPermission[] {
  return PROTECTED_PERMISSIONS.filter(({ flag }) => explicitlyHas(bits, flag));
}

function grantedProtectedPermissions(previousBits: bigint, nextBits: bigint): ProtectedPermission[] {
  return PROTECTED_PERMISSIONS.filter(({ flag }) => explicitlyHas(nextBits, flag) && !explicitlyHas(previousBits, flag));
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

async function auditMatch(guild: GuildLike, type: AuditLogEvent, targetId: string, eventTime: number, processed: Set<AuditEntryId>): Promise<AuditMatch> {
  const logs = await guild.fetchAuditLogs?.({ type, limit: 6 });
  const entries = logs?.entries ? [...logs.entries.values()] : [];
  const candidate = entries
    .filter(entry =>
      entry.target?.id === targetId
      && typeof entry.createdTimestamp === "number"
      && Math.abs(eventTime - entry.createdTimestamp) <= AUDIT_LOG_MATCH_WINDOW_MS
      && !(entry.id !== undefined && processed.has(entry.id))
    )
    .sort((left, right) => Math.abs(eventTime - (left.createdTimestamp ?? 0)) - Math.abs(eventTime - (right.createdTimestamp ?? 0)))[0];
  if (!candidate) return { executorId: null, entryId: null };
  return { executorId: candidate.executor?.id ?? null, entryId: candidate.id ?? null };
}

async function matchWithRetry(
  lookup: () => Promise<AuditMatch>,
  wait: (ms: number) => Promise<void>
): Promise<AuditMatch> {
  let match = await lookup();
  for (const delayMs of AUDIT_LOG_RETRY_DELAYS_MS) {
    if (match.executorId) return match;
    await wait(delayMs);
    match = await lookup();
  }
  return match;
}

function roles(member: MemberLike): RoleLike[] {
  return member.roles?.cache ? [...member.roles.cache.values()] : [];
}

function overwrites(channel: ChannelLike): OverwriteLike[] {
  return channel.permissionOverwrites?.cache ? [...channel.permissionOverwrites.cache.values()] : [];
}

async function channelOverwriteMatch(guild: GuildLike, channelId: string, eventTime: number, processed: Set<AuditEntryId>): Promise<AuditMatch> {
  for (const type of [AuditLogEvent.ChannelOverwriteUpdate, AuditLogEvent.ChannelOverwriteCreate]) {
    const match = await auditMatch(guild, type, channelId, eventTime, processed);
    if (match.executorId) return match;
  }
  return { executorId: null, entryId: null };
}

export function createPermissionDelegationRuntime(deps: PermissionDelegationRuntimeDeps) {
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const processedAuditEntries = new Set<AuditEntryId>();

  async function observeSensitiveAction(
    guildId: string,
    actorId: string | null,
    match: AuditMatch,
    kind: string,
    at: number
  ): Promise<RecordedObservationEvent | null> {
    if (!deps.GuildModel || !actorId || match.entryId === null) return null;
    const observation = await recordBotObservationEvent(deps.GuildModel, guildId, actorId, {
      key: `audit:${String(match.entryId)}`,
      kind,
      at: new Date(at),
      confirmed: true
    });
    if (observation.burstStarted) {
      await deps.adminAlert(
        "security:bot-observation-burst",
        "Rafala de activitate sensibila a unui bot monitorizat",
        `Bot ${actorId}; ${observation.recentCount} actiuni corelate precis prin Audit Log intr-un minut; verificare owner urgenta`,
        guildId
      );
    }
    return observation;
  }

  function shouldSendIndividualAlert(observation: RecordedObservationEvent | null): boolean {
    return !observation?.observed || observation.recentCount === 1;
  }

  function markProcessed(match: AuditMatch): void {
    if (match.entryId !== null) processedAuditEntries.add(match.entryId);
  }

  async function handleRoleUpdate(previous: RoleLike, next: RoleLike): Promise<void> {
    const granted = grantedProtectedPermissions(
      requireBitfield(previous.permissions, `rolul ${next.id} (stare anterioara)`),
      requireBitfield(next.permissions, `rolul ${next.id}`)
    );
    if (!granted.length) return;
    const eventTime = now();
    const match = await matchWithRetry(() => auditMatch(next.guild, AuditLogEvent.RoleUpdate, next.id, eventTime, processedAuditEntries), wait);
    const actorId = match.executorId;
    if (actorId && actorId === next.guild.ownerId) return;
    if (!next.setPermissions) throw new Error(`Permisiunile rolului ${next.id} nu pot fi restaurate.`);
    const currentBits = requireBitfield(next.permissions, `rolul ${next.id} (stare curenta)`);
    const stillGranted = granted.filter(({ flag }) => explicitlyHas(currentBits, flag));
    if (!stillGranted.length) return;
    markProcessed(match);
    await next.setPermissions(currentBits & ~protectedMask(stillGranted), "Protectie anti-delegare: numai ownerul poate acorda permisiuni sensibile");
    deps.metrics?.reverted();
    await recordServerAuditEntry(deps.GuildAuditLogModel, next.guild.id, {
      userId: actorId ?? "",
      action: "protected-role-permissions-reverted",
      details: `roleId=${next.id}; roleName=${next.name ?? ""}; removed=${stillGranted.map(({ label }) => label).join("+")}`
    });
    const observation = await observeSensitiveAction(next.guild.id, actorId, match, "role-permissions", eventTime);
    if (shouldSendIndividualAlert(observation)) await deps.adminAlert(
      "security:permission-delegation",
      "Delegare neautorizata de permisiuni restaurata",
      `Rol ${next.name ?? next.id}; permisiuni eliminate: ${stillGranted.map(({ label }) => label).join(", ")}; restul modificarilor raman; actor ${actorId ?? "nedetectat"}`,
      next.guild.id
    );
  }

  async function handleGuildMemberUpdate(previous: MemberLike, next: MemberLike): Promise<void> {
    const previousRoleIds = new Set(roles(previous).map(role => role.id));
    const addedProtected = roles(next).filter(role =>
      !previousRoleIds.has(role.id)
      && explicitProtectedPermissions(requireBitfield(role.permissions, `rolul ${role.id}`)).length > 0
    );
    if (!addedProtected.length) return;
    const eventTime = now();
    const match = await matchWithRetry(() => auditMatch(next.guild, AuditLogEvent.MemberRoleUpdate, next.id, eventTime, processedAuditEntries), wait);
    const actorId = match.executorId;
    if (actorId && actorId === next.guild.ownerId) return;
    if (!next.roles?.remove) throw new Error(`Rolurile sensibile ale membrului ${next.id} nu pot fi restaurate.`);
    markProcessed(match);
    for (const role of addedProtected) {
      await next.roles.remove(role.id, "Protectie anti-delegare: numai ownerul poate acorda roluri sensibile");
    }
    deps.metrics?.reverted(addedProtected.length);
    await recordServerAuditEntry(deps.GuildAuditLogModel, next.guild.id, {
      userId: actorId ?? "",
      action: "protected-member-roles-reverted",
      details: `memberId=${next.id}; roleIds=${addedProtected.map(role => role.id).join(",")}`
    });
    const observation = await observeSensitiveAction(next.guild.id, actorId, match, "member-sensitive-role", eventTime);
    if (shouldSendIndividualAlert(observation)) await deps.adminAlert(
      "security:permission-delegation",
      "Roluri sensibile acordate neautorizat si eliminate",
      `Membru ${next.id}; roluri ${addedProtected.map(role => role.name ?? role.id).join(", ")}; actor ${actorId ?? "nedetectat"}`,
      next.guild.id
    );
  }

  async function handleRoleCreate(role: RoleLike): Promise<void> {
    const grantedAtCreate = explicitProtectedPermissions(requireBitfield(role.permissions, `rolul nou ${role.id}`));
    if (!grantedAtCreate.length) return;
    const eventTime = now();
    const match = await matchWithRetry(() => auditMatch(role.guild, AuditLogEvent.RoleCreate, role.id, eventTime, processedAuditEntries), wait);
    const actorId = match.executorId;
    if (actorId && actorId === role.guild.ownerId) return;
    if (role.managed === true) {
      markProcessed(match);
      await recordServerAuditEntry(deps.GuildAuditLogModel, role.guild.id, {
        userId: actorId ?? "",
        action: "protected-managed-role-created-alerted",
        details: `roleId=${role.id}; roleName=${role.name ?? ""}; managed=true`
      });
      const observation = await observeSensitiveAction(role.guild.id, actorId, match, "managed-role-create", eventTime);
      if (shouldSendIndividualAlert(observation)) await deps.adminAlert(
        "security:permission-delegation",
        "Rol gestionat de integrare creat cu permisiuni sensibile",
        `Rol ${role.name ?? role.id} (gestionat de integrare/bot, permisiunile lui nu se restaureaza automat); actor ${actorId ?? "nedetectat"}; verificare owner necesara`,
        role.guild.id
      );
      return;
    }
    if (!role.setPermissions) throw new Error(`Permisiunile sensibile ale rolului nou ${role.id} nu pot fi eliminate.`);
    const currentBits = requireBitfield(role.permissions, `rolul nou ${role.id} (stare curenta)`);
    const stillGranted = grantedAtCreate.filter(({ flag }) => explicitlyHas(currentBits, flag));
    if (!stillGranted.length) return;
    markProcessed(match);
    await role.setPermissions(currentBits & ~protectedMask(stillGranted), "Protectie anti-delegare: numai ownerul poate crea roluri cu permisiuni sensibile");
    deps.metrics?.reverted();
    await recordServerAuditEntry(deps.GuildAuditLogModel, role.guild.id, {
      userId: actorId ?? "",
      action: "protected-role-create-reverted",
      details: `roleId=${role.id}; roleName=${role.name ?? ""}; removed=${stillGranted.map(({ label }) => label).join("+")}`
    });
    const observation = await observeSensitiveAction(role.guild.id, actorId, match, "role-create", eventTime);
    if (shouldSendIndividualAlert(observation)) await deps.adminAlert(
      "security:permission-delegation",
      "Rol nou creat cu permisiuni sensibile; permisiunile sensibile au fost eliminate",
      `Rol ${role.name ?? role.id}; permisiuni eliminate: ${stillGranted.map(({ label }) => label).join(", ")}; permisiunile neprotejate raman; actor ${actorId ?? "nedetectat"}`,
      role.guild.id
    );
  }

  async function handleChannelUpdate(previous: ChannelLike, next: ChannelLike): Promise<void> {
    const guild = next.guild;
    if (!guild?.id) return;
    const previousByTarget = new Map(overwrites(previous).map(overwrite => [overwrite.id, overwrite]));
    const violations = overwrites(next)
      .map(overwrite => {
        const before = previousByTarget.get(overwrite.id);
        const allowBits = requireBitfield(overwrite.allow, `overwrite ${overwrite.id} (allow)`);
        const beforeAllowBits = before ? requireBitfield(before.allow, `overwrite ${overwrite.id} (allow anterior)`) : 0n;
        return {
          overwrite,
          granted: CHANNEL_PROTECTED_PERMISSIONS.filter(({ flag }) => explicitlyHas(allowBits, flag) && !explicitlyHas(beforeAllowBits, flag))
        };
      })
      .filter(entry => entry.granted.length > 0);
    if (!violations.length) return;
    const eventTime = now();
    const match = await matchWithRetry(() => channelOverwriteMatch(guild, next.id, eventTime, processedAuditEntries), wait);
    const actorId = match.executorId;
    if (actorId && actorId === guild.ownerId) return;
    const edit = next.permissionOverwrites?.edit;
    if (!edit) throw new Error(`Overwrite-urile canalului ${next.id} nu pot fi restaurate.`);
    markProcessed(match);
    for (const { overwrite, granted } of violations) {
      const before = previousByTarget.get(overwrite.id);
      const beforeDenyBits = before ? requireBitfield(before.deny, `overwrite ${overwrite.id} (deny anterior)`) : 0n;
      const restore: Record<string, boolean | null> = {};
      for (const { flag, option } of granted) {
        restore[option] = explicitlyHas(beforeDenyBits, flag) ? false : null;
      }
      await edit(overwrite.id, restore, { reason: "Protectie anti-delegare: numai ownerul poate acorda permisiuni sensibile prin overwrite de canal" });
    }
    deps.metrics?.reverted(violations.length);
    await recordServerAuditEntry(deps.GuildAuditLogModel, guild.id, {
      userId: actorId ?? "",
      action: "protected-channel-overwrite-reverted",
      details: `channelId=${next.id}; targets=${violations.map(entry => `${entry.overwrite.id}:${entry.granted.map(item => item.option).join("+")}`).join(",")}`
    });
    const observation = await observeSensitiveAction(guild.id, actorId, match, "channel-overwrite", eventTime);
    if (shouldSendIndividualAlert(observation)) await deps.adminAlert(
      "security:permission-delegation",
      "Overwrite de canal cu permisiuni sensibile restaurat",
      `Canal ${next.name ?? next.id}; tinte ${violations.map(entry => entry.overwrite.id).join(", ")}; actor ${actorId ?? "nedetectat"}`,
      guild.id
    );
  }

  async function webhookAuditMatch(guild: GuildLike, channelId: string, eventTime: number): Promise<AuditMatch> {
    for (const type of [AuditLogEvent.WebhookCreate, AuditLogEvent.WebhookUpdate, AuditLogEvent.WebhookDelete]) {
      const logs = await guild.fetchAuditLogs?.({ type, limit: 6 });
      const entries = logs?.entries ? [...logs.entries.values()] : [];
      const candidate = entries
        .filter(entry =>
          entry.extra?.channel?.id === channelId
          && typeof entry.createdTimestamp === "number"
          && Math.abs(eventTime - entry.createdTimestamp) <= AUDIT_LOG_MATCH_WINDOW_MS
          && entry.id !== undefined
          && !processedAuditEntries.has(entry.id)
        )
        .sort((left, right) => Math.abs(eventTime - (left.createdTimestamp ?? 0)) - Math.abs(eventTime - (right.createdTimestamp ?? 0)))[0];
      if (candidate) return { executorId: candidate.executor?.id ?? null, entryId: candidate.id ?? null };
    }
    return { executorId: null, entryId: null };
  }

  async function handleWebhookUpdate(channel: ChannelLike): Promise<void> {
    const guild = channel.guild;
    if (!guild?.id) return;
    const eventTime = now();
    const match = await matchWithRetry(() => webhookAuditMatch(guild, channel.id, eventTime), wait);
    if (!match.executorId || match.entryId === null) return;
    markProcessed(match);
    const observation = await observeSensitiveAction(guild.id, match.executorId, match, "webhook-change", eventTime);
    if (!observation?.observed) return;
    await recordServerAuditEntry(deps.GuildAuditLogModel, guild.id, {
      userId: match.executorId,
      action: "observed-bot-webhook-change",
      details: `channelId=${channel.id}; auditEntryId=${String(match.entryId)}`
    });
    if (shouldSendIndividualAlert(observation)) {
      await deps.adminAlert(
        "security:bot-webhook-observation",
        "Bot monitorizat a modificat un webhook",
        `Bot ${match.executorId}; canal ${channel.id}; actiune atribuita precis prin Audit Log; verificare owner necesara`,
        guild.id
      );
    }
  }

  return Object.freeze({ handleRoleUpdate, handleGuildMemberUpdate, handleRoleCreate, handleChannelUpdate, handleWebhookUpdate });
}

export default { createPermissionDelegationRuntime };
