"use strict";

import type { ProtectedResourceGuild } from "../../features/command-security/protectedResourceRuntime.js";
import type { ProtectedResourceSnapshot } from "../../features/command-security/protectedResourceTypes.js";
import type { SanctionRole } from "../../features/command-security/elevatedRoleSanction.js";
import { ELEVATED_PERMISSION_FLAGS } from "../../features/command-security/elevatedPermissions.js";

const AUDIT_WINDOW_MS = 60_000;
const CATEGORY_CHANNEL_TYPE = 4;

interface AuditEntry {
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
    fetch?: (id: string) => Promise<unknown>;
  };
  fetchAuditLogs?: (options?: Record<string, unknown>) => Promise<{ entries?: Iterable<[unknown, unknown]> | { values?: () => Iterable<unknown> } } | null>;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function hasElevated(holder: unknown): boolean {
  const permissions = (holder as { permissions?: { has?: (flag: unknown) => boolean } } | null)?.permissions;
  if (!permissions?.has) return false;
  return ELEVATED_PERMISSION_FLAGS.some(flag => permissions.has?.(flag) === true);
}

function auditEntries(payload: { entries?: Iterable<[unknown, unknown]> | { values?: () => Iterable<unknown> } } | null): AuditEntry[] {
  const raw = payload?.entries;
  if (!raw) return [];
  const iterable = typeof (raw as { values?: () => Iterable<unknown> }).values === "function"
    ? (raw as { values: () => Iterable<unknown> }).values()
    : [...(raw as Iterable<[unknown, unknown]>)].map(pair => pair[1]);
  const entries: AuditEntry[] = [];
  for (const item of iterable) {
    const entry = item as { executor?: { id?: unknown }; target?: { id?: unknown }; createdTimestamp?: unknown };
    entries.push({
      executorId: textOf(entry.executor?.id),
      targetId: textOf(entry.target?.id),
      createdTimestamp: numberOf(entry.createdTimestamp) ?? 0
    });
  }
  return entries;
}

function overwritePayload(snapshot: ProtectedResourceSnapshot): Array<Record<string, unknown>> {
  return snapshot.overwrites.map(overwrite => ({
    id: overwrite.id,
    type: overwrite.type,
    allow: BigInt(overwrite.allow),
    deny: BigInt(overwrite.deny)
  }));
}

function channelEditPayload(snapshot: ProtectedResourceSnapshot): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: snapshot.name,
    permissionOverwrites: overwritePayload(snapshot)
  };
  if (snapshot.parentId !== null) payload.parent = snapshot.parentId;
  if (snapshot.position !== null) payload.position = snapshot.position;
  if (snapshot.topic !== null) payload.topic = snapshot.topic;
  if (snapshot.nsfw !== null) payload.nsfw = snapshot.nsfw;
  if (snapshot.rateLimitPerUser !== null) payload.rateLimitPerUser = snapshot.rateLimitPerUser;
  if (snapshot.bitrate !== null) payload.bitrate = snapshot.bitrate;
  if (snapshot.userLimit !== null) payload.userLimit = snapshot.userLimit;
  return payload;
}

function roleEditPayload(snapshot: ProtectedResourceSnapshot): Record<string, unknown> {
  const payload: Record<string, unknown> = { name: snapshot.name };
  if (snapshot.permissions !== null) payload.permissions = BigInt(snapshot.permissions);
  if (snapshot.position !== null) payload.position = snapshot.position;
  if (snapshot.color !== null) payload.color = snapshot.color;
  if (snapshot.hoist !== null) payload.hoist = snapshot.hoist;
  if (snapshot.mentionable !== null) payload.mentionable = snapshot.mentionable;
  return payload;
}

export function adaptProtectedResourceGuild(guild: AdaptableGuild, now: () => number = Date.now): ProtectedResourceGuild {
  async function findAuditActor(resourceId: string): Promise<string | null> {
    if (!guild.fetchAuditLogs) return null;
    const payload = await guild.fetchAuditLogs({ limit: 25 }).catch(() => null);
    const cutoff = now() - AUDIT_WINDOW_MS;
    const matching = auditEntries(payload)
      .filter(entry => entry.targetId === resourceId && entry.createdTimestamp >= cutoff)
      .sort((left, right) => right.createdTimestamp - left.createdTimestamp);
    return matching[0]?.executorId ?? null;
  }

  return {
    id: guild.id,
    ownerId: textOf(guild.ownerId),
    everyoneRoleId: textOf(guild.roles?.everyone?.id) ?? "",
    botHighestRolePosition: numberOf(guild.members?.me?.roles?.highest?.position),
    findAuditActor,
    async resolveActor(actorId) {
      const member = await guild.members?.fetch?.(actorId).catch(() => null);
      if (!member) return null;
      const holder = member as {
        roles?: { cache?: { values?: () => Iterable<unknown> }; remove?: (ids: readonly string[], reason?: string) => Promise<unknown> };
      };
      const roles: SanctionRole[] = [];
      for (const item of holder.roles?.cache?.values?.() ?? []) {
        const entry = item as { id?: unknown; name?: unknown; position?: unknown; managed?: unknown };
        const id = textOf(entry.id);
        if (!id) continue;
        roles.push({
          id,
          name: textOf(entry.name) ?? id,
          position: numberOf(entry.position) ?? 0,
          managed: entry.managed === true,
          elevated: hasElevated(entry)
        });
      }
      return {
        id: actorId,
        roles,
        removeRoles: async (ids, reason) => holder.roles?.remove?.(ids, reason) ?? undefined
      };
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
      const payload = channelEditPayload(snapshot);
      payload.type = snapshot.channelType ?? 0;
      if (snapshot.channelType === CATEGORY_CHANNEL_TYPE) delete payload.parent;
      const created = await guild.channels.create(payload);
      return textOf(created?.id);
    },
    async recreateRole(snapshot) {
      if (!guild.roles?.create) return null;
      const created = await guild.roles.create(roleEditPayload(snapshot));
      return textOf(created?.id);
    }
  };
}
