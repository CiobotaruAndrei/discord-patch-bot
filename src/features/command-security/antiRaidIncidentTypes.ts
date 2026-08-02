"use strict";

export const RAID_STAGES = ["suspected", "confirmed", "containment", "cleanup", "recovery", "resolved"] as const;
export type RaidStage = (typeof RAID_STAGES)[number];

export const SANCTION_LADDER = ["mute", "timeout", "ban"] as const;
export type SanctionStep = (typeof SANCTION_LADDER)[number];

export const PARTICIPANT_STATES = ["pending", "stopped", "failed"] as const;
export type ParticipantState = (typeof PARTICIPANT_STATES)[number];

export interface RaidParticipant {
  userId: string;
  bot: boolean;
  confirmedAt: Date;
  state: ParticipantState;
  appliedSteps: SanctionStep[];
  failedSteps: SanctionStep[];
  lastError: string | null;
}

export interface LockedChannel {
  channelId: string;
  previousSendMessages: boolean | null;
  lockedAt: Date;
  restoredAt: Date | null;
}

export interface RaidIncidentRecord {
  _id: string;
  guildId: string;
  activeKey?: string;
  stage: RaidStage;
  startedAt: Date;
  confirmedAt: Date | null;
  resolvedAt: Date | null;
  lastActivityAt: Date;
  triggerReason: string;
  manual: boolean;
  dryRun: boolean;
  participants: RaidParticipant[];
  lockedChannels: LockedChannel[];
  pendingActions: string[];
  errors: string[];
  restoreProgress: number;
}

const STAGE_ORDER: Record<RaidStage, number> = {
  suspected: 0,
  confirmed: 1,
  containment: 2,
  cleanup: 3,
  recovery: 4,
  resolved: 5
};

export function isRaidStage(value: string): value is RaidStage {
  return (RAID_STAGES as readonly string[]).includes(value);
}

export function canAdvance(from: RaidStage, to: RaidStage): boolean {
  return STAGE_ORDER[to] > STAGE_ORDER[from];
}

export function isActiveStage(stage: RaidStage): boolean {
  return stage !== "resolved";
}

export function raidConfirmed(stage: RaidStage): boolean {
  return STAGE_ORDER[stage] >= STAGE_ORDER.confirmed && stage !== "resolved";
}

export function nextSanctionStep(participant: Pick<RaidParticipant, "bot" | "appliedSteps" | "failedSteps">): SanctionStep | null {
  if (participant.bot) return participant.appliedSteps.includes("ban") ? null : "ban";
  for (const step of SANCTION_LADDER) {
    if (participant.appliedSteps.includes(step)) return null;
    if (!participant.failedSteps.includes(step)) return step;
  }
  return null;
}

export function participantSettled(participant: Pick<RaidParticipant, "bot" | "appliedSteps" | "failedSteps">): boolean {
  return nextSanctionStep(participant) === null;
}

export const COORDINATION_MINIMUM_PARTICIPANTS = 2;

export function coordinatedRaid(incident: Pick<RaidIncidentRecord, "participants">): boolean {
  return incident.participants.length >= COORDINATION_MINIMUM_PARTICIPANTS;
}

export function safetyPeriodElapsed(incident: Pick<RaidIncidentRecord, "lastActivityAt">, safetyPeriodMs: number, now: number): boolean {
  return now - new Date(incident.lastActivityAt).getTime() >= safetyPeriodMs;
}

export function lockdownOverdue(
  incident: Pick<RaidIncidentRecord, "confirmedAt" | "stage">,
  maxLockdownMs: number,
  now: number
): boolean {
  if (!incident.confirmedAt || incident.stage === "resolved") return false;
  return now - new Date(incident.confirmedAt).getTime() >= maxLockdownMs;
}

export function newIncidentId(now: number, random: () => number = Math.random): string {
  return `raid-${now.toString(36)}-${random().toString(36).slice(2, 8)}`;
}
