"use strict";

import type { PermissionDelegationRuntimeDeps } from "./permissionDelegationContext.js";

export type DelegationAuthorizer = (
  guildId: string,
  actorId: string | null,
  labels: readonly string[],
  targetId: string
) => Promise<boolean>;

export function createDelegationAuthorizer(deps: PermissionDelegationRuntimeDeps): DelegationAuthorizer {
  return async (guildId, actorId, labels, targetId) => {
    if (!deps.guard) return false;
    const situation = await deps.guard.readSituation(guildId);
    if (!situation.guardEnabled || situation.raidConfirmed) return true;
    if (!actorId) return false;
    const approval = await deps.guard.consumeApproval(guildId, actorId, labels, targetId);
    return Boolean(approval);
  };
}
