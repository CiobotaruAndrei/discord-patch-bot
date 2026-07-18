"use strict";

import moderationRepository, { type ModerationGuildModel, type ModerationRecord } from "./moderationRepository.js";

type MemberEvent = { id?: string; user?: { id?: string } | null; guild?: { id?: string } | null };
type ReconciliationMember = { id: string; communicationDisabledUntil?: Date | null };
type ReconciliationMemberCollection = { values(): IterableIterator<ReconciliationMember> };
type ReconciliationGuild = { id: string; members: { fetch(): Promise<ReconciliationMemberCollection> } };
type ReconciliationClient = { guilds?: { cache: { values(): IterableIterator<ReconciliationGuild> } } };
type Logger = (level: string, context: string, message: string, meta?: object) => void;

function latestRecord(left: ModerationRecord, right: ModerationRecord): "timeout" | "mute" {
  return new Date(left.appliedAt).getTime() >= new Date(right.appliedAt).getTime() ? "timeout" : "mute";
}

export function createModerationLifecycleRuntime(GuildModel: ModerationGuildModel, logger?: Logger) {
  async function cleanupExpired(): Promise<void> {
    await moderationRepository.cleanupExpiredModeration(GuildModel);
  }

  async function handleGuildMemberRemove(member: MemberEvent): Promise<void> {
    const guildId = member.guild?.id;
    const userId = member.user?.id ?? member.id;
    if (!guildId || !userId) return;
    await moderationRepository.removeAllModerationForUser(GuildModel, guildId, userId);
  }

  async function reconcileGuild(guild: ReconciliationGuild): Promise<number> {
    const members = await guild.members.fetch();
    const activeDiscordIds = new Set<string>();
    const now = Date.now();
    for (const member of members.values()) {
      const expiresAt = member.communicationDisabledUntil?.getTime() ?? 0;
      if (expiresAt > now) activeDiscordIds.add(member.id);
    }
    const state = await moderationRepository.getModerationState(GuildModel, guild.id);
    const timeouts = new Map((state.moderationTimeouts ?? []).map(record => [record.userId, record]));
    const mutes = new Map((state.moderationMutes ?? []).map(record => [record.userId, record]));
    const timeoutRemovals = new Set<string>();
    const muteRemovals = new Set<string>();
    for (const userId of new Set([...timeouts.keys(), ...mutes.keys()])) {
      const timeout = timeouts.get(userId);
      const mute = mutes.get(userId);
      if (!activeDiscordIds.has(userId)) {
        if (timeout) timeoutRemovals.add(userId);
        if (mute) muteRemovals.add(userId);
        continue;
      }
      if (timeout && mute) {
        if (latestRecord(timeout, mute) === "timeout") muteRemovals.add(userId);
        else timeoutRemovals.add(userId);
      }
    }
    return moderationRepository.pullModerationRecords(
      GuildModel,
      guild.id,
      [...timeoutRemovals],
      [...muteRemovals]
    );
  }

  async function reconcileClient(client: ReconciliationClient): Promise<number> {
    const guilds = client.guilds ? [...client.guilds.cache.values()] : [];
    let removed = 0;
    for (let index = 0; index < guilds.length; index += 3) {
      const batch = guilds.slice(index, index + 3);
      const results = await Promise.all(batch.map(async guild => {
        try {
          return await reconcileGuild(guild);
        } catch (error) {
          logger?.("WARN", "MODERATION_RECONCILIATION", "Reconcilierea sanctiunilor a esuat pentru un server", { guildId: guild.id, error: error instanceof Error ? error.message : String(error) });
          return 0;
        }
      }));
      removed += results.reduce((sum, value) => sum + value, 0);
    }
    return removed;
  }

  return Object.freeze({ cleanupExpired, handleGuildMemberRemove, reconcileClient });
}

export default { createModerationLifecycleRuntime };
