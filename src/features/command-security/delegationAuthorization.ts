"use strict";

import { ACTOR_UNKNOWN_OUTCOME, SANCTION_UNAVAILABLE_OUTCOME, describeSanctionOutcome, executeElevatedRoleSanction } from "./elevatedRoleSanction.js";

import type { PermissionDelegationRuntimeDeps } from "./permissionDelegationContext.js";
import type { SanctionOutcome } from "./elevatedRoleSanction.js";

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

const DELEGATION_SANCTION_REASON =
  "Protectie moderation-guard: acordare neautorizata de permisiuni ridicate; rolurile ridicate ale autorului au fost retrase";

export async function sanctionDelegationAuthor(
  deps: PermissionDelegationRuntimeDeps,
  guildId: string,
  actorId: string | null
): Promise<SanctionOutcome> {
  if (!actorId) return ACTOR_UNKNOWN_OUTCOME;

  const context = await deps.sanctionContext(guildId).catch(() => null);
  if (!context) return SANCTION_UNAVAILABLE_OUTCOME;

  return executeElevatedRoleSanction({
    resolveActor: () => context.resolveActor(actorId),
    botHighestRolePosition: context.botHighestRolePosition,
    everyoneRoleId: context.everyoneRoleId,
    reason: DELEGATION_SANCTION_REASON
  });
}

export { describeSanctionOutcome };

export async function reportRaidEscalation(
  deps: PermissionDelegationRuntimeDeps,
  guildId: string,
  actorId: string | null,
  surface: string
): Promise<void> {
  if (!deps.reportRaidActor || !actorId) return;
  await deps.reportRaidActor(guildId, actorId, surface).catch(() => undefined);
}
