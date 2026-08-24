"use strict";

import { securityIncident } from "./securityIncidentContract.js";

import type { SecurityIncident, SecuritySeverity } from "./securityIncidentContract.js";
import type { ServerAuditLogEntry } from "../admin-records/adminRecordsTypes.js";
import type { RaidIncidentRecord } from "./antiRaidIncidentTypes.js";
import type { PermissionRequestRecord } from "./permissionRequestTypes.js";
import type { AdRequestRecord, AdAttemptRecord } from "./adRequestTypes.js";

const CRITICAL_AUDIT_MARKERS = ["owner-intervention", "reverted", "sanctioned", "raid"];

function auditSeverity(action: string): SecuritySeverity {
  if (action.includes("owner-intervention")) return "critical";
  return CRITICAL_AUDIT_MARKERS.some(marker => action.includes(marker)) ? "warning" : "info";
}

function dateOf(value: unknown): Date {
  if (value instanceof Date) return value;
  const parsed = new Date(String(value ?? ""));
  return Number.isFinite(parsed.getTime()) ? parsed : new Date(0);
}

export function projectAuditEntry(record: ServerAuditLogEntry): SecurityIncident {
  return securityIncident({
    incidentId: `audit:${record.serverId}:${record.action}:${dateOf(record.at).getTime()}:${record.userId}`,
    module: "audit",
    source: "audit",
    at: dateOf(record.at),
    actorId: record.userId || null,
    target: record.targetId ?? null,
    actions: [record.action],
    result: "inregistrat in auditul serverului",
    severity: auditSeverity(record.action),
    evidence: record.details ?? ""
  });
}

export function projectRaidIncident(record: RaidIncidentRecord): SecurityIncident {
  const settled = record.participants.filter(entry => entry.state !== "pending").length;
  return securityIncident({
    incidentId: record._id,
    module: "anti-raid",
    source: "raid",
    at: dateOf(record.startedAt),
    actions: [`incident ${record.stage}`, ...(record.dryRun ? ["simulare"] : [])],
    result: record.stage === "resolved"
      ? `incident inchis; participanti sanctionati: ${settled}/${record.participants.length}`
      : `incident activ in etapa ${record.stage}; participanti: ${record.participants.length}`,
    severity: record.dryRun ? "info" : record.stage === "resolved" ? "warning" : "critical",
    evidence: `${record.triggerReason}${record.errors.length > 0 ? `; erori: ${record.errors.join(" | ")}` : ""}`
  });
}

export function projectPermissionRequest(record: PermissionRequestRecord): SecurityIncident {
  return securityIncident({
    incidentId: `approval:${record._id}`,
    module: "moderation-guard",
    source: "approval",
    at: dateOf(record.respondedAt ?? record.requestedAt),
    actorId: record.ownerId ?? record.requesterId,
    target: record.target ?? null,
    approvalId: record._id,
    actions: [record.type, record.action ?? "cerere"],
    result: `aprobare ${record.status}`,
    severity: record.status === "approved" ? "warning" : "info",
    evidence: record.reason ?? ""
  });
}

export function projectAdRequest(record: AdRequestRecord): SecurityIncident {
  return securityIncident({
    incidentId: `ad-request:${record._id}`,
    module: "ad-protection",
    source: "approval",
    at: dateOf(record.respondedAt ?? record.requestedAt),
    actorId: record.ownerId ?? record.requesterId,
    target: record.requesterId,
    approvalId: record._id,
    actions: ["reclama"],
    result: `aprobare ${record.status}`,
    severity: record.status === "approved" ? "warning" : "info",
    evidence: record.target ?? record.adText
  });
}

export function projectAdAttempts(record: AdAttemptRecord): SecurityIncident[] {
  return record.history.map((event, index) => {
    const removed = event.deleted !== false;
    const primary = removed ? "reclama stearsa" : "reclama detectata, NU a putut fi stearsa";
    return securityIncident({
      incidentId: `ad-attempt:${record.guildId}:${record.userId}:${dateOf(event.at).getTime()}:${index}`,
      module: "ad-protection",
      source: "ad",
      at: dateOf(event.at),
      actorId: record.userId,
      target: record.userId,
      actions: event.warned ? [primary, "warn automat"] : [primary],
      result: event.warned ? `${primary} si warn emis` : primary,
      severity: removed && !event.warned ? "info" : "warning",
      evidence: event.summary
    });
  });
}
