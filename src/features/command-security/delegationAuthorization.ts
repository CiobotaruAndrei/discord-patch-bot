"use strict";

import type { PermissionDelegationRuntimeDeps } from "./permissionDelegationContext.js";

export type DelegationVerdict = "allow" | "revert-guard" | "revert-raid";

export type DelegationAuthorizer = (
  guildId: string,
  actorId: string | null,
  labels: readonly string[],
  targetId: string
) => Promise<DelegationVerdict>;

export function reverts(verdict: DelegationVerdict): boolean {
  return verdict !== "allow";
}

export function createDelegationAuthorizer(deps: PermissionDelegationRuntimeDeps): DelegationAuthorizer {
  return async (guildId, actorId, labels, targetId) => {
    if (!deps.guard) return "revert-guard";
    const situation = await deps.guard.readSituation(guildId);
    if (!situation.guardEnabled) return "allow";
    if (situation.raidConfirmed) return "revert-raid";
    if (!actorId) return "revert-guard";
    const approval = await deps.guard.consumeApproval(guildId, actorId, labels, targetId);
    return approval ? "allow" : "revert-guard";
  };
}

export async function reportRaidEscalation(
  deps: PermissionDelegationRuntimeDeps,
  guildId: string,
  actorId: string | null,
  surface: string
): Promise<void> {
  if (!deps.reportRaidActor || !actorId) return;
  await deps.reportRaidActor(guildId, actorId, surface).catch(() => undefined);
}
