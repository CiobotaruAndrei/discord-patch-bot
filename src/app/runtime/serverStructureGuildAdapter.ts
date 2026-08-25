"use strict";

import { resolveSanctionActor } from "./sanctionActorAdapter.js";
import { channelCreatePayload, roleEditPayload } from "../../features/command-security/resourceSnapshotPayload.js";

import type { AdaptableRaidGuild } from "./antiRaidGuildAdapter.js";
import type { SanctionRole } from "../../features/command-security/elevatedRoleSanction.js";
import type { StructureGuardGuild } from "../../features/command-security/serverStructureGuardRuntime.js";
import type { StructureChangeKind } from "../../features/command-security/serverStructureActions.js";

const AUDIT_WINDOW_MS = 60_000;
const AUDIT_RETRY_DELAYS_MS = [0, 1_000, 2_000] as const;

const AUDIT_EVENT_BY_KIND: Record<StructureChangeKind, number> = {
  channelCreate: 10,
  channelDelete: 12,
  roleCreate: 30,
  roleDelete: 32
};

export interface AdaptableStructureGuild extends AdaptableRaidGuild {
  ownerId?: unknown;
  roles?: AdaptableRaidGuild["roles"] & {
    everyone?: { id?: unknown };
    cache?: { get?: (id: string) => unknown };
    create?: (payload: Record<string, unknown>) => Promise<{ id?: unknown } | null>;
  };
  channels?: AdaptableRaidGuild["channels"] & {
    create?: (payload: Record<string, unknown>) => Promise<{ id?: unknown } | null>;
  };
  members?: AdaptableRaidGuild["members"] & { me?: { roles?: { highest?: { position?: unknown } } } | null };
}

interface DeletableResource {
  delete?: (reason?: string) => Promise<unknown>;
}

function cacheOf(guild: AdaptableStructureGuild, kind: StructureChangeKind): { get?: (id: string) => unknown } | undefined {
  return kind === "roleCreate" || kind === "roleDelete" ? guild.roles?.cache : guild.channels?.cache;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function iterate(source: unknown): unknown[] {
  if (!source) return [];
  if (typeof (source as { values?: () => Iterable<unknown> }).values === "function") {
    return [...(source as { values: () => Iterable<unknown> }).values()];
  }
  const items = [...(source as Iterable<unknown>)];
  return items.map(item => (Array.isArray(item) && item.length === 2 ? item[1] : item));
}

export function adaptStructureGuardGuild(
  guild: AdaptableStructureGuild,
  now: () => number = Date.now,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))
): StructureGuardGuild | null {
  const id = textOf(guild.id);
  if (!id) return null;

  return {
    id,
    ownerId: textOf(guild.ownerId),
    botHighestRolePosition: numberOf(guild.members?.me?.roles?.highest?.position),
    everyoneRoleId: textOf(guild.roles?.everyone?.id) ?? "",
    async findStructureActor(kind, resourceId) {
      if (!guild.fetchAuditLogs) return null;
      const type = AUDIT_EVENT_BY_KIND[kind];
      for (const delayMs of AUDIT_RETRY_DELAYS_MS) {
        if (delayMs > 0) await wait(delayMs);
        const payload = await guild.fetchAuditLogs({ type, limit: 10 }).catch(() => null);
        const cutoff = now() - AUDIT_WINDOW_MS;
        let best: { id: string; at: number } | null = null;
        for (const item of iterate(payload?.entries ?? null)) {
          const entry = item as { executor?: { id?: unknown }; target?: { id?: unknown }; createdTimestamp?: unknown };
          if (textOf(entry.target?.id) !== resourceId) continue;
          const at = numberOf(entry.createdTimestamp) ?? 0;
          if (at < cutoff) continue;
          const executorId = textOf(entry.executor?.id);
          if (!executorId) continue;
          if (!best || at > best.at) best = { id: executorId, at };
        }
        if (best) return best.id;
      }
      return null;
    },
    async resolveActor(actorId) {
      return resolveSanctionActor(guild, actorId);
    },
    async removeCreatedResource(kind, resourceId, reason) {
      const resource = cacheOf(guild, kind)?.get?.(resourceId) as DeletableResource | undefined;
      if (!resource?.delete) return false;
      await resource.delete(reason);
      return true;
    },
    async recreateDeletedResource(kind, snapshot) {
      if (kind === "roleDelete") {
        if (!guild.roles?.create) return null;
        const created = await guild.roles.create(roleEditPayload(snapshot));
        return textOf(created?.id);
      }
      if (!guild.channels?.create) return null;
      const created = await guild.channels.create(channelCreatePayload(snapshot));
      return textOf(created?.id);
    },
    async resourceExists(kind, resourceId) {
      return Boolean(cacheOf(guild, kind)?.get?.(resourceId));
    }
  };
}
