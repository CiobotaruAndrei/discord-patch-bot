"use strict";

import { MODERATION_GUARD_TYPES } from "./moderationGuardDecision.js";

import type { AdProtectionRepository } from "./adProtectionRepository.js";
import type { PermissionRequestRepository } from "./permissionRequestRepository.js";

export interface ProtectionStopDeps {
  guardRequests?: PermissionRequestRepository;
  adRequests?: AdProtectionRepository;
  countBotAddApprovals: () => number;
  stopBotAddAtomically: () => Promise<void>;
  disableProtection: () => Promise<void>;
}

export interface ProtectionStopActions {
  needsAtomicStop: boolean;
  countActiveApprovals: () => Promise<number>;
  stopAtomically: () => Promise<void>;
}

export function protectionStopActions(
  subcommand: string,
  guildId: string,
  deps: ProtectionStopDeps
): ProtectionStopActions {
  const usesGuard = subcommand === "moderation-guard" && Boolean(deps.guardRequests);
  const usesAds = subcommand === "ad-protection" && Boolean(deps.adRequests);

  return {
    needsAtomicStop: subcommand === "bot-add-protection" || usesGuard || usesAds,

    countActiveApprovals: async () => {
      if (usesAds && deps.adRequests) {
        const listed = await deps.adRequests.listRequests(guildId, 500);
        return listed.filter(entry => entry.status === "pending" || entry.status === "approved").length;
      }
      if (usesGuard && deps.guardRequests) return deps.guardRequests.countActive(guildId);
      return deps.countBotAddApprovals();
    },

    stopAtomically: async () => {
      if (usesAds && deps.adRequests) {
        await deps.adRequests.cancelActiveRequests(guildId);
        await deps.disableProtection();
        return;
      }
      if (usesGuard && deps.guardRequests) {
        await deps.guardRequests.cancelTypes(guildId, MODERATION_GUARD_TYPES);
        await deps.disableProtection();
        return;
      }
      await deps.stopBotAddAtomically();
    }
  };
}
