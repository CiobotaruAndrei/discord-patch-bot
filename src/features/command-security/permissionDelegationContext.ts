"use strict";

import type { PermissionDelegationMetricRecorder } from "../../shared/metricRecorderPorts.js";
import { AuditLogEvent, PermissionFlagsBits } from "discord.js";
import { recordServerAuditEntry, type GuildAuditLogModelLike } from "../admin-records/auditLogRepository.js";
import {
  recordBotObservationEvent,
  type BotObservationModelLike,
  type RecordedObservationEvent
} from "./botObservationRepository.js";

export type PermissionSet = { has(flag: bigint): boolean; bitfield?: bigint };
export type AuditEntryId = string | number;
export type RoleLike = {
  id: string;
  name?: string;
  managed?: boolean;
  permissions: PermissionSet;
  guild: GuildLike;
  setPermissions?(permissions: bigint, reason?: string): Promise<unknown>;
};
export type OverwriteLike = { id: string; allow: PermissionSet; deny: PermissionSet };
export type OverwriteCollection = { values(): IterableIterator<OverwriteLike> };
export type ChannelLike = {
  id: string;
  name?: string;
  guild?: GuildLike | null;
  permissionOverwrites?: {
    cache?: OverwriteCollection;
    edit?(targetId: string, permissions: Record<string, boolean | null>, options?: { reason?: string }): Promise<unknown>;
  };
};
export type RoleCollection = { values(): IterableIterator<RoleLike> };
export type MemberLike = {
  id: string;
  guild: GuildLike;
  roles?: {
    cache?: RoleCollection;
    remove?(roleId: string, reason?: string): Promise<unknown>;
  };
};
export type AuditEntry = {
  id?: AuditEntryId;
  target?: { id?: string } | null;
  executor?: { id?: string } | null;
  createdTimestamp?: number;
  extra?: { channel?: { id?: string } | null } | null;
};

export interface AuditMatch {
  executorId: string | null;
  entryId: AuditEntryId | null;
}
export type GuildLike = {
  id: string;
  ownerId?: string;
  fetchAuditLogs?(options: { type: AuditLogEvent; limit: number }): Promise<{ entries?: { values(): IterableIterator<AuditEntry> } }>;
};
export type DelegationMetrics = { permissionDelegationsReverted?: number };

export interface GuardedDelegationGate {
  readSituation(guildId: string): Promise<{ guardEnabled: boolean; raidConfirmed: boolean }>;
  consumeApproval(guildId: string, requesterId: string, permissions: readonly string[], targetId: string): Promise<{ _id: string } | null>;
}

export interface PermissionDelegationRuntimeDeps {
  GuildModel?: BotObservationModelLike;
  GuildAuditLogModel: GuildAuditLogModelLike;
  adminAlert(kind: string, title: string, body: string, guildId?: string): Promise<unknown>;
  metrics?: PermissionDelegationMetricRecorder;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  guard?: GuardedDelegationGate;
}

export const AUDIT_LOG_MATCH_WINDOW_MS = 60_000;
const AUDIT_LOG_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000];

export const PROTECTED_PERMISSIONS = [
  { flag: PermissionFlagsBits.Administrator, label: "Administrator" },
  { flag: PermissionFlagsBits.BanMembers, label: "Ban Members" },
  { flag: PermissionFlagsBits.KickMembers, label: "Kick Members" },
  { flag: PermissionFlagsBits.ModerateMembers, label: "Moderate Members" },
  { flag: PermissionFlagsBits.ManageWebhooks, label: "Manage Webhooks" }
] as const;

export type ProtectedPermission = (typeof PROTECTED_PERMISSIONS)[number];

export const CHANNEL_PROTECTED_PERMISSIONS = [
  { flag: PermissionFlagsBits.ManageWebhooks, option: "ManageWebhooks" }
] as const;

export function explicitlyHas(bits: bigint, flag: bigint): boolean {
  return (bits & flag) === flag;
}

export function explicitProtectedPermissions(bits: bigint): ProtectedPermission[] {
  return PROTECTED_PERMISSIONS.filter(({ flag }) => explicitlyHas(bits, flag));
}

export function grantedProtectedPermissions(previousBits: bigint, nextBits: bigint): ProtectedPermission[] {
  return PROTECTED_PERMISSIONS.filter(({ flag }) => explicitlyHas(nextBits, flag) && !explicitlyHas(previousBits, flag));
}

export function protectedMask(granted: readonly ProtectedPermission[]): bigint {
  return granted.reduce((mask, { flag }) => mask | flag, 0n);
}

export function requireBitfield(permissions: PermissionSet, subject: string): bigint {
  if (typeof permissions.bitfield !== "bigint") {
    throw new Error(`Bitfield-ul permisiunilor pentru ${subject} nu este disponibil pentru restaurarea stricta.`);
  }
  return permissions.bitfield;
}

export async function auditMatch(guild: GuildLike, type: AuditLogEvent, targetId: string, eventTime: number, processed: Set<AuditEntryId>): Promise<AuditMatch> {
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

export async function matchWithRetry(
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

export function roles(member: MemberLike): RoleLike[] {
  return member.roles?.cache ? [...member.roles.cache.values()] : [];
}

export function overwrites(channel: ChannelLike): OverwriteLike[] {
  return channel.permissionOverwrites?.cache ? [...channel.permissionOverwrites.cache.values()] : [];
}

export async function channelOverwriteMatch(guild: GuildLike, channelId: string, eventTime: number, processed: Set<AuditEntryId>): Promise<AuditMatch> {
  for (const type of [AuditLogEvent.ChannelOverwriteUpdate, AuditLogEvent.ChannelOverwriteCreate]) {
    const match = await auditMatch(guild, type, channelId, eventTime, processed);
    if (match.executorId) return match;
  }
  return { executorId: null, entryId: null };
}

export type { RecordedObservationEvent };
