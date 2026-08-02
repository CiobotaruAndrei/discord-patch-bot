"use strict";

import type { RaidGuildPort, SanctionOutcome } from "../../features/command-security/antiRaidIntervention.js";
import type { SanctionStep } from "../../features/command-security/antiRaidIncidentTypes.js";
import { ELEVATED_PERMISSION_FLAGS } from "../../features/command-security/elevatedPermissions.js";

const PURGE_BATCH = 100;
const BOT_ADD_AUDIT_EVENT = 28;
const BOT_ADD_WINDOW_MS = 60_000;
const BOT_ADD_RETRY_DELAYS_MS = [0, 1_000, 2_000] as const;
const TIMEOUT_CAP_MS = 28 * 24 * 3_600_000;
const RETRYABLE_CODES = new Set([500, 502, 503, 504, 429]);

type Logger = (level: string, scope: string, message: string, detail?: Record<string, unknown>) => void;

const AUDIT_WINDOW_MS = 60_000;

export interface AdaptableRaidGuild {
  id: string;
  fetchAuditLogs?: (options?: Record<string, unknown>) => Promise<{ entries?: Iterable<[unknown, unknown]> | { values?: () => Iterable<unknown> } } | null>;
  roles?: { everyone?: { id?: unknown }; cache?: { values?: () => Iterable<unknown> } };
  channels?: { cache?: { get?: (id: string) => unknown } };
  members?: { fetch?: (options: { user: string; force: boolean }) => Promise<unknown>; me?: { roles?: { highest?: { position?: unknown } } } | null };
  bans?: { create?: (userId: string, options?: Record<string, unknown>) => Promise<unknown> };
}

function errorCode(error: unknown): number | null {
  const status = (error as { status?: unknown; httpStatus?: unknown } | null);
  const value = typeof status?.status === "number" ? status.status : status?.httpStatus;
  return typeof value === "number" ? value : null;
}

function isRetryable(error: unknown): boolean {
  const code = errorCode(error);
  if (code !== null) return RETRYABLE_CODES.has(code);
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|ETIMEDOUT|ECONNRESET|rate limit/i.test(message);
}

function failure(error: unknown): SanctionOutcome {
  return {
    applied: false,
    retryable: isRetryable(error),
    error: error instanceof Error ? error.message : String(error)
  };
}

export async function findRaidStructureActor(
  guild: AdaptableRaidGuild,
  resourceId: string,
  now: () => number = Date.now
): Promise<{ id: string; bot: boolean } | null> {
  if (!guild.fetchAuditLogs) return null;
  const payload = await guild.fetchAuditLogs({ limit: 25 }).catch(() => null);
  const raw = payload?.entries;
  if (!raw) return null;
  const iterable = typeof (raw as { values?: () => Iterable<unknown> }).values === "function"
    ? (raw as { values: () => Iterable<unknown> }).values()
    : [...(raw as Iterable<[unknown, unknown]>)].map(pair => pair[1]);

  const cutoff = now() - AUDIT_WINDOW_MS;
  let best: { id: string; bot: boolean; at: number } | null = null;
  for (const item of iterable) {
    const entry = item as {
      executor?: { id?: unknown; bot?: unknown };
      target?: { id?: unknown };
      createdTimestamp?: unknown
    };
    const executorId = typeof entry.executor?.id === "string" ? entry.executor.id : null;
    const targetId = typeof entry.target?.id === "string" ? entry.target.id : null;
    const at = typeof entry.createdTimestamp === "number" ? entry.createdTimestamp : 0;
    if (!executorId || targetId !== resourceId || at < cutoff) continue;
    if (!best || at > best.at) best = { id: executorId, bot: entry.executor?.bot === true, at };
  }
  return best ? { id: best.id, bot: best.bot } : null;
}

export function adaptRaidGuild(
  guild: AdaptableRaidGuild,
  readGuildSettings: (guildId: string) => Promise<{ antiRaidAlertChannelId?: string | null; permissionRequestChannelId?: string | null } | null>,
  logger?: Logger,
  now: () => number = Date.now
): RaidGuildPort {
  function channel(channelId: string): {
    permissionOverwrites?: {
      edit?: (target: unknown, permissions: Record<string, boolean | null>, options?: Record<string, unknown>) => Promise<unknown>;
      cache?: { get?: (id: string) => { allow?: { has?: (flag: string) => boolean }; deny?: { has?: (flag: string) => boolean } } | undefined };
    };
    bulkDelete?: (messages: unknown, filterOld?: boolean) => Promise<{ size?: number } | null>;
    messages?: { fetch?: (options: Record<string, unknown>) => Promise<{ filter?: (predicate: (message: unknown) => boolean) => { size?: number } } | null> };
    send?: (payload: Record<string, unknown>) => Promise<unknown>;
  } | undefined {
    return guild.channels?.cache?.get?.(channelId) as ReturnType<typeof channel>;
  }

  async function alertChannel(): Promise<{ send?: (payload: Record<string, unknown>) => Promise<unknown> } | null> {
    const settings = await readGuildSettings(guild.id).catch(() => null);
    const channelId = settings?.antiRaidAlertChannelId ?? settings?.permissionRequestChannelId;
    if (typeof channelId !== "string" || !channelId) return null;
    return channel(channelId) ?? null;
  }

  async function member(userId: string): Promise<{
    timeout?: (durationMs: number | null, reason?: string) => Promise<unknown>;
    voice?: { setMute?: (mute: boolean, reason?: string) => Promise<unknown> };
    ban?: (options?: Record<string, unknown>) => Promise<unknown>;
    communicationDisabledUntilTimestamp?: number | null;
    roles?: {
      cache?: { has?: (roleId: string) => boolean; values?: () => Iterable<unknown> };
      add?: (roleId: string, reason?: string) => Promise<unknown>;
      remove?: (roleIds: readonly string[], reason?: string) => Promise<unknown>;
    };
  } | null> {
    const fetched = await guild.members?.fetch?.({ user: userId, force: true }).catch(() => null);
    return (fetched as Awaited<ReturnType<typeof member>>) ?? null;
  }

  function mutedRole(): { id: string; position: number } | null {
    const values = guild.roles?.cache?.values?.();
    if (!values) return null;
    for (const item of values) {
      const role = item as { id?: unknown; name?: unknown; position?: unknown };
      const name = typeof role.name === "string" ? role.name.trim().toLowerCase() : "";
      const id = typeof role.id === "string" ? role.id : null;
      if (!id || (name !== "muted" && name !== "mut")) continue;
      return { id, position: typeof role.position === "number" ? role.position : 0 };
    }
    return null;
  }

  return {
    id: guild.id,

    async lockChannel(channelId) {
      const target = channel(channelId);
      const everyoneId = guild.roles?.everyone?.id;
      if (!target?.permissionOverwrites?.edit || typeof everyoneId !== "string") {
        return { locked: false, previousSendMessages: null };
      }
      const current = target.permissionOverwrites.cache?.get?.(everyoneId);
      const previousSendMessages = current?.allow?.has?.("SendMessages") === true
        ? true
        : current?.deny?.has?.("SendMessages") === true ? false : null;

      await target.permissionOverwrites.edit(everyoneId, { SendMessages: false }, { reason: "Anti-raid: lockdown" });
      return { locked: true, previousSendMessages };
    },

    async unlockChannel(channelId, previousSendMessages) {
      const target = channel(channelId);
      const everyoneId = guild.roles?.everyone?.id;
      if (!target?.permissionOverwrites?.edit || typeof everyoneId !== "string") return false;
      await target.permissionOverwrites.edit(
        everyoneId,
        { SendMessages: previousSendMessages },
        { reason: "Anti-raid: ridicarea lockdown-ului" }
      );
      return true;
    },

    async applySanction(userId: string, step: SanctionStep, durationMs: number, reason: string) {
      try {
        if (step === "ban") {
          if (guild.bans?.create) {
            await guild.bans.create(userId, { reason });
            return { applied: true, retryable: false, error: null };
          }
          const target = await member(userId);
          if (!target?.ban) return { applied: false, retryable: false, error: "banul nu este disponibil" };
          await target.ban({ reason });
          return { applied: true, retryable: false, error: null };
        }

        const target = await member(userId);
        if (!target) return { applied: false, retryable: false, error: "membrul nu a putut fi gasit" };

        if (step === "mute") {
          const role = mutedRole();
          if (!role || !target.roles?.add) {
            return { applied: false, retryable: false, error: "nu exista un rol Muted aplicabil, deci mute-ul nu poate opri scrisul" };
          }
          const highest = guild.members?.me?.roles?.highest?.position;
          const botPosition = typeof highest === "number" && Number.isFinite(highest) ? highest : null;
          if (botPosition === null || role.position >= botPosition) {
            return { applied: false, retryable: false, error: "rolul Muted este peste rolul botului" };
          }
          await target.roles.add(role.id, reason);
          if (target.voice?.setMute) await Promise.resolve(target.voice.setMute(true, reason)).catch(() => undefined);
          const after = await member(userId);
          if (after?.roles?.cache?.has?.(role.id) !== true) {
            return { applied: false, retryable: true, error: "rolul Muted nu a ramas aplicat dupa verificare" };
          }
          return { applied: true, retryable: false, error: null };
        }

        if (!target.timeout) return { applied: false, retryable: false, error: "timeout-ul nu este disponibil" };
        await target.timeout(Math.min(durationMs, TIMEOUT_CAP_MS), reason);
        const afterTimeout = await member(userId);
        const until = afterTimeout?.communicationDisabledUntilTimestamp ?? null;
        if (until === null || until <= now()) {
          return { applied: false, retryable: true, error: "timeout-ul nu a ramas aplicat dupa verificare" };
        }
        return { applied: true, retryable: false, error: null };
      } catch (error: unknown) {
        return failure(error);
      }
    },

    async findBotAdder(botId: string) {
      if (!guild.fetchAuditLogs) return null;
      const cutoff = now() - BOT_ADD_WINDOW_MS;
      for (const delayMs of BOT_ADD_RETRY_DELAYS_MS) {
        if (delayMs > 0) await new Promise<void>(resolve => setTimeout(resolve, delayMs));
        const payload = await guild.fetchAuditLogs({ type: BOT_ADD_AUDIT_EVENT, limit: 10 }).catch(() => null);
        const raw = payload?.entries;
        const iterable = !raw
          ? []
          : typeof (raw as { values?: () => Iterable<unknown> }).values === "function"
            ? [...(raw as { values: () => Iterable<unknown> }).values()]
            : [...(raw as Iterable<[unknown, unknown]>)].map(pair => pair[1]);
        for (const item of iterable) {
          const entry = item as { executor?: { id?: unknown }; target?: { id?: unknown }; createdTimestamp?: unknown };
          if (typeof entry.target?.id !== "string" || entry.target.id !== botId) continue;
          const at = typeof entry.createdTimestamp === "number" ? entry.createdTimestamp : 0;
          if (at < cutoff) continue;
          if (typeof entry.executor?.id === "string" && entry.executor.id) return entry.executor.id;
        }
      }
      return null;
    },

    async stripElevatedRoles(userId: string, reason: string) {
      const target = await member(userId);
      const highest = guild.members?.me?.roles?.highest?.position;
      const botPosition = typeof highest === "number" && Number.isFinite(highest) ? highest : null;
      const removed: string[] = [];
      const blocked: string[] = [];
      const removable: string[] = [];

      for (const item of target?.roles?.cache?.values?.() ?? []) {
        const role = item as { id?: unknown; name?: unknown; position?: unknown; managed?: unknown; permissions?: { has?: (flag: unknown) => boolean } };
        const roleId = typeof role.id === "string" ? role.id : null;
        if (!roleId || roleId === guild.roles?.everyone?.id) continue;
        if (!ELEVATED_PERMISSION_FLAGS.some(flag => role.permissions?.has?.(flag) === true)) continue;
        const label = typeof role.name === "string" ? role.name : roleId;
        const position = typeof role.position === "number" ? role.position : 0;
        if (role.managed === true || botPosition === null || position >= botPosition) {
          blocked.push(label);
          continue;
        }
        removable.push(roleId);
        removed.push(label);
      }

      if (removable.length > 0 && target?.roles?.remove) {
        await Promise.resolve(target.roles.remove(removable, reason)).catch(() => {
          blocked.push(...removed);
          removed.length = 0;
        });
      }
      return { removed, blocked };
    },

    async purgeMessages(channelIds, userIds) {
      if (userIds.length === 0) return 0;
      const targets = new Set(userIds);
      let deleted = 0;

      for (const channelId of channelIds) {
        const target = channel(channelId);
        if (!target?.messages?.fetch || !target.bulkDelete) continue;
        try {
          const fetched = await target.messages.fetch({ limit: PURGE_BATCH });
          const doomed = fetched?.filter?.(message => {
            const authorId = (message as { author?: { id?: unknown } } | null)?.author?.id;
            return typeof authorId === "string" && targets.has(authorId);
          });
          if (!doomed || (doomed.size ?? 0) === 0) continue;
          const removed = await target.bulkDelete(doomed, true);
          deleted += removed?.size ?? 0;
        } catch (error: unknown) {
          logger?.("WARN", "ANTI_RAID", "Curatarea mesajelor a esuat pentru un canal", {
            guildId: guild.id,
            channelId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      return deleted;
    },

    async publish(body) {
      const target = await alertChannel();
      return target?.send ? target.send({ content: body }) : undefined;
    },

    async alertOwner(body) {
      const target = await alertChannel();
      return target?.send ? target.send({ content: `**Interventie necesara** ${body}` }) : undefined;
    }
  };
}
