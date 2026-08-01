"use strict";

import { formatDuration } from "../command-security/antiRaidThresholds.js";

import type { RaidIncidentRecord, RaidParticipant } from "../command-security/antiRaidIncidentTypes.js";

const STAGE_LABELS: Record<string, string> = {
  suspected: "suspectat",
  confirmed: "confirmat",
  containment: "izolare",
  cleanup: "curatare",
  recovery: "restaurare",
  resolved: "inchis"
};

function moment(value: Date | null): string {
  return value ? new Date(value).toISOString().replace("T", " ").slice(0, 19) : "-";
}

export function describeParticipant(participant: RaidParticipant): string {
  const applied = participant.appliedSteps.length > 0 ? participant.appliedSteps.join(", ") : "niciuna";
  const failed = participant.failedSteps.length > 0 ? `; esuate: ${participant.failedSteps.join(", ")}` : "";
  const error = participant.lastError ? `; ultima eroare: ${participant.lastError}` : "";
  const kind = participant.bot ? "bot" : "membru";
  return `<@${participant.userId}> (${kind}, ${participant.state}) — sanctiuni aplicate: ${applied}${failed}${error}`;
}

function countStopped(incident: RaidIncidentRecord): number {
  return incident.participants.filter(participant => participant.state === "stopped").length;
}

function countFailed(incident: RaidIncidentRecord): number {
  return incident.participants.filter(participant => participant.state === "failed").length;
}

export function participantLines(incident: RaidIncidentRecord): string[] {
  if (incident.participants.length === 0) return [];
  const failed = countFailed(incident);
  const header = `Incident \`${incident._id}\` — participanti: ${incident.participants.length}, opriti: ${countStopped(incident)}`;
  return [
    failed > 0 ? `${header}, nesanctionabili: ${failed}` : header,
    ...incident.participants.map(describeParticipant)
  ];
}

export function statusLines(incident: RaidIncidentRecord | null, safetyPeriodMs: number, now: number): string[] {
  if (!incident) return [];

  const lockedActive = incident.lockedChannels.filter(entry => !entry.restoredAt);
  const stopped = countStopped(incident);
  const failed = countFailed(incident);
  const elapsedSinceActivity = now - new Date(incident.lastActivityAt).getTime();
  const remainingSafety = Math.max(0, safetyPeriodMs - elapsedSinceActivity);
  const lockdownMs = incident.confirmedAt ? now - new Date(incident.confirmedAt).getTime() : 0;

  const lines = [
    `**Incident \`${incident._id}\`** — etapa: **${STAGE_LABELS[incident.stage] ?? incident.stage}**${incident.dryRun ? " (dry-run)" : ""}${incident.manual ? " (pornit manual)" : ""}`,
    `Motiv: ${incident.triggerReason || "-"}`,
    `Inceput: ${moment(incident.startedAt)}; confirmat: ${moment(incident.confirmedAt)}; inchis: ${moment(incident.resolvedAt)}`,
    `Canale blocate acum: ${lockedActive.length > 0 ? lockedActive.map(entry => `<#${entry.channelId}>`).join(", ") : "niciunul"}`,
    `Participanti: ${incident.participants.length} (opriti: ${stopped}, nesanctionabili: ${failed}, ramasi: ${incident.participants.length - stopped - failed})`,
    `Durata lockdown-ului: ${incident.confirmedAt ? formatDuration(lockdownMs) : "-"}`,
    `Timp ramas din perioada de siguranta: ${incident.stage === "resolved" ? "-" : formatDuration(remainingSafety)}`,
    `Restaurare: ${incident.restoreProgress}%`
  ];

  if (incident.pendingActions.length > 0) lines.push(`Operatiuni ramase: ${incident.pendingActions.join("; ")}`);
  if (incident.errors.length > 0) {
    lines.push(`Erori (${incident.errors.length}), ultimele:`);
    lines.push(...incident.errors.slice(-5).map(error => `  - ${error}`));
  }
  return lines;
}
