"use strict";

import { createPermissionRequestRepository } from "./permissionRequestRepository.js";

import type { GuardedDelegationGate } from "./permissionDelegationContext.js";
import type { PermissionRequestModelLike } from "./permissionRequestRepository.js";

export interface ModerationGuardGateDeps {
  PermissionRequestModel: PermissionRequestModelLike;
  readGuildSettings: (guildId: string) => Promise<{ moderationGuardEnabled?: boolean } | null>;
  isRaidConfirmed?: (guildId: string) => Promise<boolean>;
}

export function createModerationGuardGate(deps: ModerationGuardGateDeps): GuardedDelegationGate {
  const requests = createPermissionRequestRepository(deps.PermissionRequestModel);

  return {
    async readSituation(guildId) {
      const settings = await deps.readGuildSettings(guildId).catch(() => null);
      const raidConfirmed = deps.isRaidConfirmed ? await deps.isRaidConfirmed(guildId).catch(() => false) : false;
      return { guardEnabled: settings?.moderationGuardEnabled === true, raidConfirmed };
    },
    async consumeApproval(guildId, requesterId, permissions, targetId) {
      return requests.consume(guildId, "permission-grant", requesterId, {
        target: targetId,
        action: "grant",
        permissions: [...permissions]
      }).catch(() => null);
    }
  };
}
