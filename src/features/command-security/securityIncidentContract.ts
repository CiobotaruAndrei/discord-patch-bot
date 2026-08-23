"use strict";

import { redact } from "./securityLogModel.js";

import type { SecurityLogEntry, SecurityLogSource } from "./securityLogModel.js";

export const SECURITY_INCIDENT_VERSION = 1;

export const SECURITY_MODULES = [
  "audit",
  "anti-raid",
  "moderation-guard",
  "ad-protection",
  "protected-resource"
] as const;

export type SecurityModule = (typeof SECURITY_MODULES)[number];

export const SECURITY_SEVERITIES = ["info", "warning", "critical"] as const;

export type SecuritySeverity = (typeof SECURITY_SEVERITIES)[number];

export interface SecurityIncident {
  version: number;
  incidentId: string;
  module: SecurityModule;
  source: SecurityLogSource;
  at: Date;
  actorId: string | null;
  target: string | null;
  approvalId: string | null;
  actions: string[];
  result: string;
  severity: SecuritySeverity;
  evidence: string;
}

export interface IncidentInput {
  incidentId: string;
  module: SecurityModule;
  source: SecurityLogSource;
  at: Date;
  actorId?: string | null;
  target?: string | null;
  approvalId?: string | null;
  actions?: readonly string[];
  result: string;
  severity: SecuritySeverity;
  evidence?: string;
}

export function securityIncident(input: IncidentInput): SecurityIncident {
  return {
    version: SECURITY_INCIDENT_VERSION,
    incidentId: input.incidentId,
    module: input.module,
    source: input.source,
    at: input.at instanceof Date && Number.isFinite(input.at.getTime()) ? input.at : new Date(0),
    actorId: input.actorId ?? null,
    target: input.target ?? null,
    approvalId: input.approvalId ?? null,
    actions: [...(input.actions ?? [])],
    result: input.result,
    severity: input.severity,
    evidence: redact(input.evidence ?? "")
  };
}

export function dedupeIncidents(incidents: readonly SecurityIncident[]): SecurityIncident[] {
  const byId = new Map<string, SecurityIncident>();
  for (const incident of incidents) {
    const existing = byId.get(incident.incidentId);
    if (!existing || incident.at.getTime() > existing.at.getTime()) byId.set(incident.incidentId, incident);
  }
  return [...byId.values()];
}

export function orderIncidents(incidents: readonly SecurityIncident[]): SecurityIncident[] {
  return dedupeIncidents(incidents).sort((left, right) => right.at.getTime() - left.at.getTime());
}

export function severityRank(severity: SecuritySeverity): number {
  return SECURITY_SEVERITIES.indexOf(severity);
}

export function toLogEntry(incident: SecurityIncident): SecurityLogEntry {
  const scope = [
    incident.target ? `tinta ${incident.target}` : null,
    incident.approvalId ? `aprobare ${incident.approvalId}` : null
  ].filter((part): part is string => part !== null);

  const summary = [incident.result, ...scope, incident.evidence].filter(part => part.length > 0).join("; ");

  return {
    source: incident.source,
    at: incident.at,
    action: `[${incident.severity}] ${incident.module}: ${incident.actions.join(", ") || "eveniment"}`,
    actorId: incident.actorId,
    summary
  };
}
