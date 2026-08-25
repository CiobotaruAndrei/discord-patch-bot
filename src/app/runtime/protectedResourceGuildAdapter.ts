"use strict";

import type { ProtectedResourceGuild } from "../../features/command-security/protectedResourceRuntime.js";
import type { ProtectedResourceSnapshot } from "../../features/command-security/protectedResourceTypes.js";
import type { SanctionRole } from "../../features/command-security/elevatedRoleSanction.js";
import { resolveSanctionActor } from "./sanctionActorAdapter.js";
import { channelCreatePayload, channelEditPayload, roleEditPayload } from "../../features/command-security/resourceSnapshotPayload.js";

const AUDIT_WINDOW_MS = 60_000;
const AUDIT_AMBIGUITY_MS = 2_000;
const MAX_PROCESSED_AUDIT_ENTRIES = 500;

interface AuditEntry {
  id: string | null;
  executorId: string | null;
  targetId: string | null;
  createdTimestamp: number;
}

export interface AdaptableGuild {
  id: string;
  ownerId?: string | null;
  roles?: {
    everyone?: { id?: unknown };
    highest?: { position?: unknown };
    cache?: { get?: (id: string) => unknown };
    create?: (options: Record<string, unknown>) => Promise<{ id?: unknown } | null>;
  };
  channels?: {
    cache?: { get?: (id: string) => unknown };
    create?: (options: Record<string, unknown>) => Promise<{ id?: unknown } | null>;
  };
  members?: {
    me?: { roles?: { highest?: { position?: unknown } } } | null;
    fetch?: (options: { user: string; force: boolean }) => Promise<unknown>;
  };
  fetchAuditLogs?: (options?: Record<string, unknown>) => Promise<{ entries?: Iterable<[unknown, unknown]> | { values?: () => Iterable<unknown> } } | null>;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function auditEntries(payload: { entries?: Iterable<[unknown, unknown]> | { values?: () => Iterable<unknown> } } | null): AuditEntry[] {
  const raw = payload?.entries;
  if (!raw) return [];
  const iterable = typeof (raw as { values?: () => Iterable<unknown> }).values === "function"
    ? (raw as { values: () => Iterable<unknown> }).values()
    : [...(raw as Iterable<[unknown, unknown]>)].map(pair => pair[1]);
  const entries: AuditEntry[] = [];
  for (const item of iterable) {
    const entry = item as { id?: unknown; executor?: { id?: unknown }; target?: { id?: unknown }; createdTimestamp?: unknown };
    entries.push({
      id: textOf(entry.id) ?? (typeof entry.id === "number" ? String(entry.id) : null),
      executorId: textOf(entry.executor?.id),
      targetId: textOf(entry.target?.id),
      createdTimestamp: numberOf(entry.createdTimestamp) ?? 0
    });
  }
  return entries;
}

export function adaptProtectedResourceGuild(
  guild: AdaptableGuild,
  now: () => number = Date.now,
  processedAuditEntries: Set<string> = new Set()
): ProtectedResourceGuild {
  async function findAuditActor(resourceId: string, events: readonly number[]): Promise<string | null> {
    if (!guild.fetchAuditLogs) return null;
    const moment = now();
    const cutoff = moment - AUDIT_WINDOW_MS;
    const candidates: AuditEntry[] = [];

    for (const type of events.length > 0 ? events : [undefined]) {
      const payload = await guild
        .fetchAuditLogs(type === undefined ? { limit: 25 } : { type, limit: 25 })
        .catch(() => null);
      for (const entry of auditEntries(payload)) {
        if (entry.targetId !== resourceId || entry.createdTimestamp < cutoff) continue;
        if (entry.id !== null && processedAuditEntries.has(entry.id)) continue;
        candidates.push(entry);
      }
    }

    if (candidates.length === 0) return null;

    candidates.sort((left, right) =>
      Math.abs(moment - left.createdTimestamp) - Math.abs(moment - right.createdTimestamp));

    const closest = candidates[0];
    const rival = candidates.find(entry =>
      entry.executorId !== closest.executorId
      && Math.abs(entry.createdTimestamp - closest.createdTimestamp) <= AUDIT_AMBIGUITY_MS);
    if (rival) return null;

    if (closest.id !== null) {
      if (processedAuditEntries.size >= MAX_PROCESSED_AUDIT_ENTRIES) processedAuditEntries.clear();
      processedAuditEntries.add(closest.id);
    }
    return closest.executorId;
  }

  return {
    id: guild.id,
    ownerId: textOf(guild.ownerId),
    everyoneRoleId: textOf(guild.roles?.everyone?.id) ?? "",
    botHighestRolePosition: numberOf(guild.members?.me?.roles?.highest?.position),
    findAuditActor,
    async resolveActor(actorId) {
      const actor = await resolveSanctionActor(guild, actorId);
      return actor ? { id: actorId, ...actor } : null;
    },
    async restoreChannel(resourceId, snapshot) {
      const channel = guild.channels?.cache?.get?.(resourceId) as { edit?: (payload: Record<string, unknown>) => Promise<unknown> } | undefined;
      if (!channel?.edit) return false;
      await channel.edit(channelEditPayload(snapshot));
      return true;
    },
    async restoreRole(resourceId, snapshot) {
      const role = guild.roles?.cache?.get?.(resourceId) as { edit?: (payload: Record<string, unknown>) => Promise<unknown> } | undefined;
      if (!role?.edit) return false;
      await role.edit(roleEditPayload(snapshot));
      return true;
    },
    async recreateChannel(snapshot) {
      if (!guild.channels?.create) return null;
      const created = await guild.channels.create(channelCreatePayload(snapshot));
      return textOf(created?.id);
    },
    async recreateRole(snapshot) {
      if (!guild.roles?.create) return null;
      const created = await guild.roles.create(roleEditPayload(snapshot));
      return textOf(created?.id);
    }
  };
}
