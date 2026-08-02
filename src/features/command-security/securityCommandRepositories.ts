"use strict";

import { createAdProtectionRepository } from "./adProtectionRepository.js";
import { createPermissionRequestRepository } from "./permissionRequestRepository.js";
import { createRaidIncidentRepository } from "./antiRaidIncidentRepository.js";

import type { AdProtectionRepository } from "./adProtectionRepository.js";
import type { PermissionRequestRepository } from "./permissionRequestRepository.js";
import type { RaidIncidentRepository } from "./antiRaidIncidentRepository.js";
import type { SecurityDeps } from "./securityInteractionContracts.js";

export interface SecurityRepositories {
  adRequests: AdProtectionRepository | undefined;
  guardRequests: PermissionRequestRepository | undefined;
  raidIncidents: RaidIncidentRepository | undefined;
}

export function securityRepositories(target: SecurityDeps): SecurityRepositories {
  return {
    adRequests: target.AdRequestModel && target.AdAttemptModel
      ? createAdProtectionRepository(target.AdRequestModel, target.AdAttemptModel)
      : undefined,
    guardRequests: target.PermissionRequestModel
      ? createPermissionRequestRepository(target.PermissionRequestModel)
      : undefined,
    raidIncidents: target.RaidIncidentModel
      ? createRaidIncidentRepository(target.RaidIncidentModel)
      : undefined
  };
}
