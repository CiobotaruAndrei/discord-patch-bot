"use strict";

import type { RaidGuildPort, SanctionOutcome } from "../../features/command-security/antiRaidIntervention.js";
import type { SanctionStep } from "../../features/command-security/antiRaidIncidentTypes.js";

const PURGE_BATCH = 100;
const TIMEOUT_CAP_MS = 28 * 24 * 3_600_000;
const RETRYABLE_CODES = new Set([500, 502, 503, 504, 429]);

type Logger = (level: string, scope: string, message: string, detail?: Record<string, unknown>) => void;

export interface AdaptableRaidGuild {
  id: string;
  roles?: { everyone?: { id?: unknown } };
  channels?: { cache?: { get?: (id: string) => unknown } };
  members?: { fetch?: (id: string) => Promise<unknown> };
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

export function adaptRaidGuild(
  guild: AdaptableRaidGuild,
  readGuildSettings: (guildId: string) => Promise<{ antiRaidAlertChannelId?: string | null; permissionRequestChannelId?: string | null } | null>,
  logger?: Logger
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
  } | null> {
    const fetched = await guild.members?.fetch?.(userId).catch(() => null);
    return (fetched as Awaited<ReturnType<typeof member>>) ?? null;
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
          if (!target.voice?.setMute) return { applied: false, retryable: false, error: "mute-ul vocal nu este disponibil" };
          await target.voice.setMute(true, reason);
          return { applied: true, retryable: false, error: null };
        }

        if (!target.timeout) return { applied: false, retryable: false, error: "timeout-ul nu este disponibil" };
        await target.timeout(Math.min(durationMs, TIMEOUT_CAP_MS), reason);
        return { applied: true, retryable: false, error: null };
      } catch (error: unknown) {
        return failure(error);
      }
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
