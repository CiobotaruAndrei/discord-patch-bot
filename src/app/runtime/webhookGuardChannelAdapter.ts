"use strict";

import { resolveSanctionActor } from "./sanctionActorAdapter.js";

import type { SanctionRole } from "../../features/command-security/elevatedRoleSanction.js";
import type { WebhookGuardChannel } from "../../features/command-security/webhookGuardRuntime.js";
import type { WebhookSnapshotEntry } from "../../features/command-security/webhookGuardTypes.js";

const AUDIT_WINDOW_MS = 60_000;
const WEBHOOK_AUDIT_EVENTS = [50, 51, 52];

export interface AdaptableWebhookChannel {
  id?: string;
  name?: unknown;
  guild?: {
    id?: unknown;
    ownerId?: unknown;
    roles?: { everyone?: { id?: unknown } };
    members?: { me?: { roles?: { highest?: { position?: unknown } } } | null; fetch?: (options: { user: string; force: boolean }) => Promise<unknown> };
    fetchAuditLogs?: (options?: Record<string, unknown>) => Promise<{ entries?: Iterable<[unknown, unknown]> | { values?: () => Iterable<unknown> } } | null>;
  } | null;
  fetchWebhooks?: () => Promise<Iterable<unknown> | { values?: () => Iterable<unknown> } | null>;
  createWebhook?: (options: Record<string, unknown>) => Promise<{ id?: unknown } | null>;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function iterate(source: Iterable<unknown> | { values?: () => Iterable<unknown> } | null): unknown[] {
  if (!source) return [];
  if (typeof (source as { values?: () => Iterable<unknown> }).values === "function") {
    return [...(source as { values: () => Iterable<unknown> }).values()];
  }
  const items = [...(source as Iterable<unknown>)];
  return items.map(item => (Array.isArray(item) && item.length === 2 ? item[1] : item));
}

export function adaptWebhookGuardChannel(
  channel: AdaptableWebhookChannel,
  now: () => number = Date.now
): WebhookGuardChannel | null {
  const guild = channel.guild;
  const guildId = textOf(guild?.id);
  const channelId: string = textOf(channel.id) ?? "";
  if (!guildId || channelId.length === 0) return null;

  const webhookById = new Map<string, { delete?: (reason?: string) => Promise<unknown>; edit?: (payload: Record<string, unknown>, reason?: string) => Promise<unknown> }>();

  async function listWebhooks(): Promise<WebhookSnapshotEntry[]> {
    if (!channel.fetchWebhooks) return [];
    const payload = await channel.fetchWebhooks();
    webhookById.clear();
    const entries: WebhookSnapshotEntry[] = [];
    for (const item of iterate(payload)) {
      const hook = item as {
        id?: unknown;
        name?: unknown;
        avatar?: unknown;
        owner?: { id?: unknown };
        delete?: (reason?: string) => Promise<unknown>;
        edit?: (payload: Record<string, unknown>, reason?: string) => Promise<unknown>;
      };
      const id = textOf(hook.id);
      if (!id) continue;
      webhookById.set(id, hook);
      entries.push({
        webhookId: id,
        channelId,
        name: typeof hook.name === "string" ? hook.name : "",
        avatar: textOf(hook.avatar),
        creatorId: textOf(hook.owner?.id)
      });
    }
    return entries;
  }

  return {
    guildId,
    channelId,
    channelName: textOf(channel.name) ?? channelId,
    ownerId: textOf(guild?.ownerId),
    botHighestRolePosition: numberOf(guild?.members?.me?.roles?.highest?.position),
    everyoneRoleId: textOf(guild?.roles?.everyone?.id) ?? "",
    listWebhooks,
    async findAuditActor() {
      if (!guild?.fetchAuditLogs) return null;
      const cutoff = now() - AUDIT_WINDOW_MS;
      const candidates: Array<{ executorId: string | null; createdTimestamp: number }> = [];
      for (const type of WEBHOOK_AUDIT_EVENTS) {
        const payload = await guild.fetchAuditLogs({ type, limit: 6 }).catch(() => null);
        for (const item of iterate(payload?.entries ?? null)) {
          const entry = item as { executor?: { id?: unknown }; createdTimestamp?: unknown };
          const createdTimestamp = numberOf(entry.createdTimestamp) ?? 0;
          if (createdTimestamp < cutoff) continue;
          candidates.push({ executorId: textOf(entry.executor?.id), createdTimestamp });
        }
      }
      candidates.sort((left, right) => right.createdTimestamp - left.createdTimestamp);
      return candidates[0]?.executorId ?? null;
    },
    async deleteWebhook(webhookId, reason) {
      const hook = webhookById.get(webhookId);
      if (!hook?.delete) throw new Error(`Webhook-ul ${webhookId} nu poate fi sters.`);
      await hook.delete(reason);
    },
    async editWebhook(webhookId, patch, reason) {
      const hook = webhookById.get(webhookId);
      if (!hook?.edit) throw new Error(`Webhook-ul ${webhookId} nu poate fi restaurat.`);
      await hook.edit({ name: patch.name, avatar: patch.avatar }, reason);
    },
    async recreateWebhook(entry, reason) {
      if (!channel.createWebhook) return null;
      const created = await channel.createWebhook({ name: entry.name || "webhook", avatar: entry.avatar, reason });
      return textOf(created?.id);
    },
    async resolveActor(actorId) {
      return guild ? resolveSanctionActor(guild, actorId) : null;
    }
  };
}
