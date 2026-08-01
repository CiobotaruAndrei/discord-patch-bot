"use strict";

import type { PermissionRequestScope, PermissionRequestType } from "./permissionRequestTypes.js";

export const MODERATION_GUARD_TYPES: readonly PermissionRequestType[] = [
  "bot-add",
  "permission-grant",
  "moderation-mass",
  "webhook",
  "server-structure",
  "protected-resource-change"
];

export type GuardVerdict =
  | { kind: "guard-off" }
  | { kind: "raid-active" }
  | { kind: "actor-unknown" }
  | { kind: "allowed-owner" }
  | { kind: "allowed-approval"; requestId: string }
  | { kind: "unauthorized" };

export interface GuardSituation {
  guardEnabled: boolean;
  raidConfirmed: boolean;
  ownerId: string | null;
  actorId: string | null;
}

export interface GuardApprovalLookup {
  consume: (
    type: PermissionRequestType,
    requesterId: string,
    attempt: PermissionRequestScope
  ) => Promise<{ _id: string } | null>;
}

export function shouldEvaluate(situation: GuardSituation): boolean {
  return situation.guardEnabled && !situation.raidConfirmed;
}

export async function evaluateGuardedAction(
  situation: GuardSituation,
  type: PermissionRequestType,
  attempt: PermissionRequestScope,
  approvals: GuardApprovalLookup
): Promise<GuardVerdict> {
  if (!situation.guardEnabled) return { kind: "guard-off" };
  if (situation.raidConfirmed) return { kind: "raid-active" };
  if (!situation.actorId) return { kind: "actor-unknown" };
  if (situation.ownerId && situation.actorId === situation.ownerId) return { kind: "allowed-owner" };

  const approval = await approvals.consume(type, situation.actorId, attempt);
  if (approval) return { kind: "allowed-approval", requestId: approval._id };
  return { kind: "unauthorized" };
}

export function requiresCorrection(verdict: GuardVerdict): boolean {
  return verdict.kind === "unauthorized";
}

export function requiresOwnerIntervention(verdict: GuardVerdict): boolean {
  return verdict.kind === "actor-unknown";
}
