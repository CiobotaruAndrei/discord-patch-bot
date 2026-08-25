"use strict";

import type { RaidStage } from "./antiRaidIncidentTypes.js";

export const RAID_INTERVENTION_STAGES = ["confirmed", "containment", "cleanup", "recovery"] as const;
export type RaidInterventionStage = (typeof RAID_INTERVENTION_STAGES)[number];

export function isInterventionStage(stage: string): stage is RaidInterventionStage {
  return (RAID_INTERVENTION_STAGES as readonly string[]).includes(stage);
}

export type AntiRaidStopDecision =
  | { kind: "allowed"; incidentId: string; stage: RaidInterventionStage }
  | { kind: "no-incident" }
  | { kind: "stage-too-early"; incidentId: string; stage: RaidStage };

export function decideAntiRaidStop(incident: { _id: string; stage: RaidStage } | null): AntiRaidStopDecision {
  if (!incident) return { kind: "no-incident" };
  if (!isInterventionStage(incident.stage)) {
    return { kind: "stage-too-early", incidentId: incident._id, stage: incident.stage };
  }
  return { kind: "allowed", incidentId: incident._id, stage: incident.stage };
}

export function describeAntiRaidStopRefusal(decision: AntiRaidStopDecision): string | null {
  if (decision.kind === "no-incident") {
    return "Protectia anti-raid nu poate fi oprita: nu exista niciun incident activ. "
      + "Oprirea e prevazuta pentru situatia in care un raid confirmat a fost tratat si serverul trece prin recovery, "
      + "nu ca dezactivare generala a protectiei.";
  }
  if (decision.kind === "stage-too-early") {
    return `Protectia anti-raid nu poate fi oprita: incidentul \`${decision.incidentId}\` e in etapa \`${decision.stage}\`, `
      + `nu intr-una de interventie (${RAID_INTERVENTION_STAGES.join(", ")}). `
      + "Un incident doar suspectat inca se evalueaza; oprirea acum ar lasa serverul fara protectie exact in fereastra "
      + "in care raidul se confirma.";
  }
  return null;
}
