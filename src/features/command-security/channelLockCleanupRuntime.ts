"use strict";

import type { SecurityRuntimeDeps, SecurityChannel } from "./securityEventContext.js";

export function createChannelLockCleanupRuntime(deps: SecurityRuntimeDeps) {
  async function handleChannelDelete(channel: SecurityChannel & { guild?: { id?: string } | null }): Promise<void> {
    const guildId = channel.guild?.id;
    if (!guildId || !channel.id) return;
    await deps.GuildModel.updateOne(
      { _id: guildId },
      {
        $pull: {
          lockedChannelIds: channel.id,
          lockedChannelPermissions: { channelId: channel.id }
        }
      }
    );
  }

  return { handleChannelDelete };
}
