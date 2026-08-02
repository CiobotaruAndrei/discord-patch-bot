"use strict";

import { MODERATION_GUARD_TYPES } from "./moderationGuardDecision.js";

import type { AdProtectionRepository } from "./adProtectionRepository.js";
import type { PermissionRequestRepository } from "./permissionRequestRepository.js";
import type { RaidIncidentRepository } from "./antiRaidIncidentRepository.js";

export interface ProtectionStopDeps {
  guardRequests?: PermissionRequestRepository;
  adRequests?: AdProtectionRepository;
  raidIncidents?: RaidIncidentRepository;
  disableProtection: () => Promise<void>;
}

export interface ProtectionStopActions {
  needsAtomicStop: boolean;
  countActiveApprovals: () => Promise<number>;
  stopAtomically: () => Promise<string | null>;
}

export function protectionStopActions(
  subcommand: string,
  guildId: string,
  deps: ProtectionStopDeps
): ProtectionStopActions {
  const usesGuard = subcommand === "moderation-guard" && Boolean(deps.guardRequests);
  const usesAds = subcommand === "ad-protection" && Boolean(deps.adRequests);
  const usesDryRun = subcommand === "anti-raid-dry-run" && Boolean(deps.raidIncidents);

  return {
    needsAtomicStop: usesGuard || usesAds || usesDryRun,

    countActiveApprovals: async () => {
      if (usesAds && deps.adRequests) {
        const listed = await deps.adRequests.listRequests(guildId, 500);
        return listed.filter(entry => entry.status === "pending" || entry.status === "approved").length;
      }
      if (usesGuard && deps.guardRequests) return deps.guardRequests.countActive(guildId);
      return 0;
    },

    stopAtomically: async () => {
      if (usesDryRun && deps.raidIncidents) {
        const closed = await deps.raidIncidents.resolveDryRuns(guildId);
        await deps.disableProtection();
        return closed.length > 0
          ? `Simulari inchise: ${closed.length} (${closed.join(", ")}). Nicio actiune reala nu a fost aplicata, iar incidentele apar in /security-log.`
          : "Nu exista nicio simulare activa de inchis.";
      }
      if (usesAds && deps.adRequests) {
        await deps.adRequests.cancelActiveRequests(guildId);
        await deps.disableProtection();
        return null;
      }
      if (usesGuard && deps.guardRequests) await deps.guardRequests.cancelTypes(guildId, MODERATION_GUARD_TYPES);
      await deps.disableProtection();
      return null;
    }
  };
}
