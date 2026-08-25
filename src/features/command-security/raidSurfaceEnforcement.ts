"use strict";

export const RAID_SURFACES = ["protected-resource", "server-structure", "webhook"] as const;
export type RaidSurface = (typeof RAID_SURFACES)[number];

export type RaidSurfaceAction = "correct-now" | "defer-to-recovery";

export interface RaidSurfacePolicy {
  onChange: RaidSurfaceAction;
  onDelete: RaidSurfaceAction;
  refreshBaseline: false;
}

const POLICIES: Record<RaidSurface, RaidSurfacePolicy> = {
  "protected-resource": { onChange: "correct-now", onDelete: "defer-to-recovery", refreshBaseline: false },
  "server-structure": { onChange: "correct-now", onDelete: "correct-now", refreshBaseline: false },
  webhook: { onChange: "correct-now", onDelete: "correct-now", refreshBaseline: false }
};

export function raidPolicyFor(surface: RaidSurface): RaidSurfacePolicy {
  return POLICIES[surface];
}

export function correctsDuringRaid(surface: RaidSurface, kind: "change" | "delete"): boolean {
  const policy = POLICIES[surface];
  return (kind === "delete" ? policy.onDelete : policy.onChange) === "correct-now";
}

export function refreshesBaselineDuringRaid(surface: RaidSurface): boolean {
  return POLICIES[surface].refreshBaseline;
}

export function describeRaidCorrection(surface: RaidSurface, kind: "change" | "delete"): string {
  if (!correctsDuringRaid(surface, kind)) {
    return "Resursa ramane inregistrata pentru recovery: recrearea in timpul raidului ar intra in conflict cu planul de restaurare.";
  }
  return surface === "protected-resource"
    ? "Modificarea a fost corectata imediat din snapshotul de dinaintea raidului, fara sa avanseze baseline-ul."
    : "Modificarea a fost corectata imediat, fara sa avanseze baseline-ul.";
}
