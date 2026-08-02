"use strict";

import { MODERATION_GUARD_TYPES } from "./moderationGuardDecision.js";

import type { GuildSettingsLike, ProtectionChannelField, ProtectionEnabledField } from "./securitySettingsContracts.js";

export type ProtectionState = "pornit" | "oprit" | "incomplet" | "degradat";

export interface ProtectionStatus {
  key: string;
  label: string;
  state: ProtectionState;
  gaps: string[];
}

export interface SecurityStatusInput {
  settings: GuildSettingsLike | null;
  readinessGaps: Readonly<Record<string, readonly string[]>>;
  activeApprovals: number;
  degradedResources: number;
  ownerInterventionOperations: number;
  raidStage: string | null;
}

export interface SecurityStatusReport {
  protections: ProtectionStatus[];
  subprotections: ProtectionStatus[];
  activeApprovals: number;
  degradedResources: number;
  ownerInterventionOperations: number;
  raidStage: string | null;
}

const PROTECTIONS: ReadonlyArray<{ key: string; label: string; enabled: ProtectionEnabledField; channel: ProtectionChannelField }> = [
  { key: "new-account-alerts", label: "Alerte cont nou", enabled: "newAccountAlertsEnabled", channel: "newAccountAlertChannelId" },
  { key: "threat-protection", label: "Protectie amenintari", enabled: "threatProtectionEnabled", channel: "threatAlertChannelId" },
  { key: "moderation-guard", label: "Moderation guard", enabled: "moderationGuardEnabled", channel: "permissionRequestChannelId" },
  { key: "anti-raid", label: "Anti-raid", enabled: "antiRaidEnabled", channel: "antiRaidAlertChannelId" },
  { key: "anti-raid-dry-run", label: "Anti-raid (testare)", enabled: "antiRaidDryRunEnabled", channel: "antiRaidAlertChannelId" },
  { key: "ad-protection", label: "Protectie reclame", enabled: "adProtectionEnabled", channel: "adAlertChannelId" }
];

const SUBPROTECTION_LABELS: Readonly<Record<string, string>> = {
  "bot-add": "Adaugare boti",
  "permission-grant": "Acordare de permisiuni",
  "moderation-mass": "Moderare in masa",
  "webhook": "Webhook-uri",
  "server-structure": "Structura serverului",
  "protected-resource-change": "Resurse protejate"
};

function stateFor(enabled: boolean, channelSet: boolean, gaps: readonly string[]): ProtectionState {
  if (!enabled) return "oprit";
  if (!channelSet) return "incomplet";
  return gaps.length > 0 ? "degradat" : "pornit";
}

export function buildSecurityStatus(input: SecurityStatusInput): SecurityStatusReport {
  const settings = input.settings;

  const protections = PROTECTIONS.map(entry => {
    const enabled = settings?.[entry.enabled] === true;
    const channel = settings?.[entry.channel];
    const channelSet = typeof channel === "string" && channel.length > 0;
    const gaps = [...(input.readinessGaps[entry.key] ?? [])];
    return { key: entry.key, label: entry.label, state: stateFor(enabled, channelSet, gaps), gaps };
  });

  const guardEnabled = settings?.moderationGuardEnabled === true;
  const guardChannel = typeof settings?.permissionRequestChannelId === "string" && settings.permissionRequestChannelId.length > 0;
  const guardGaps = [...(input.readinessGaps["moderation-guard"] ?? [])];

  const subprotections = MODERATION_GUARD_TYPES.map(type => ({
    key: type,
    label: SUBPROTECTION_LABELS[type] ?? type,
    state: stateFor(guardEnabled, guardChannel, guardGaps),
    gaps: guardGaps
  }));

  return {
    protections,
    subprotections,
    activeApprovals: input.activeApprovals,
    degradedResources: input.degradedResources,
    ownerInterventionOperations: input.ownerInterventionOperations,
    raidStage: input.raidStage
  };
}

export function renderSecurityStatus(report: SecurityStatusReport): string {
  const line = (entry: ProtectionStatus): string =>
    `- ${entry.label}: **${entry.state}**${entry.gaps.length > 0 ? ` (lipseste: ${entry.gaps.join(", ")})` : ""}`;

  const lines = ["**Protectii**", ...report.protections.map(line), "", "**Subprotectii moderation-guard**", ...report.subprotections.map(line), ""];

  lines.push(`Aprobari active: ${report.activeApprovals}`);
  if (report.degradedResources > 0) lines.push(`Resurse protejate degradate: ${report.degradedResources}`);
  if (report.ownerInterventionOperations > 0) {
    lines.push(`Operatiuni de restaurare care cer interventia ownerului: ${report.ownerInterventionOperations}`);
  }
  lines.push(report.raidStage ? `Incident anti-raid activ, etapa: ${report.raidStage}` : "Niciun incident anti-raid activ.");

  return lines.join("\n");
}
