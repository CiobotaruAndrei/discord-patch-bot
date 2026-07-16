"use strict";

import moderationRepository, { type ModerationGuildModel } from "./moderationRepository.js";

type MemberEvent = { id?: string; user?: { id?: string } | null; guild?: { id?: string } | null };

export function createModerationLifecycleRuntime(GuildModel: ModerationGuildModel) {
  async function cleanupExpired(): Promise<void> {
    await moderationRepository.cleanupExpiredModeration(GuildModel);
  }

  async function handleGuildMemberRemove(member: MemberEvent): Promise<void> {
    const guildId = member.guild?.id;
    const userId = member.user?.id ?? member.id;
    if (!guildId || !userId) return;
    await moderationRepository.removeAllModerationForUser(GuildModel, guildId, userId);
  }

  return Object.freeze({ cleanupExpired, handleGuildMemberRemove });
}

export default { createModerationLifecycleRuntime };
