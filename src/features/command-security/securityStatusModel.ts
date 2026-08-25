"use strict";

import { MODERATION_GUARD_TYPES } from "./moderationGuardDecision.js";
import { describeChannelSource, resolveProtectionChannel } from "./securityChannelResolution.js";

import type { GuildSettingsLike, ProtectionEnabledField } from "./securitySettingsContracts.js";

export type ProtectionState = "pornit" | "oprit" | "incomplet" | "degradat";

export interface ProtectionStatus {
  key: string;
  label: string;
  state: ProtectionState;
  gaps: string[];
  channelNote?: string | null;
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

const PROTECTIONS: ReadonlyArray<{ key: string; label: string; enabled: ProtectionEnabledField }> = [
  { key: "new-account-alerts", label: "Alerte cont nou", enabled: "newAccountAlertsEnabled" },
  { key: "threat-protection", label: "Protectie amenintari", enabled: "threatProtectionEnabled" },
  { key: "moderation-guard", label: "Moderation guard", enabled: "moderationGuardEnabled" },
  { key: "anti-raid", label: "Anti-raid", enabled: "antiRaidEnabled" },
  { key: "anti-raid-dry-run", label: "Anti-raid (testare)", enabled: "antiRaidDryRunEnabled" },
  { key: "ad-protection", label: "Protectie reclame", enabled: "adProtectionEnabled" }
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
    const channelSet = resolveProtectionChannel(entry.key, settings) !== null;
    const source = describeChannelSource(entry.key, settings);
    const gaps = [...(input.readinessGaps[entry.key] ?? [])];
    return { key: entry.key, label: entry.label, state: stateFor(enabled, channelSet, gaps), gaps, channelNote: source };
  });

  const guardEnabled = settings?.moderationGuardEnabled === true;
  const guardChannel = resolveProtectionChannel("moderation-guard", settings) !== null;
  const guardGaps = [...(input.readinessGaps["moderation-guard"] ?? [])];

  const subprotections = MODERATION_GUARD_TYPES.map(type => {
    const gaps = [...(input.readinessGaps[type] ?? guardGaps)];
    return {
      key: type,
      label: SUBPROTECTION_LABELS[type] ?? type,
      state: stateFor(guardEnabled, guardChannel, gaps),
      gaps
    };
  });

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
  const line = (entry: ProtectionStatus): string => {
    const gaps = entry.gaps.length > 0 ? ` (lipseste: ${entry.gaps.join(", ")})` : "";
    const note = entry.channelNote ? ` - ${entry.channelNote}` : "";
    return `- ${entry.label}: **${entry.state}**${gaps}${note}`;
  };

  const lines = ["**Protectii**", ...report.protections.map(line), "", "**Subprotectii moderation-guard**", ...report.subprotections.map(line), ""];

  lines.push(`Aprobari active: ${report.activeApprovals}`);
  if (report.degradedResources > 0) lines.push(`Resurse protejate degradate: ${report.degradedResources}`);
  if (report.ownerInterventionOperations > 0) {
    lines.push(`Operatiuni de restaurare care cer interventia ownerului: ${report.ownerInterventionOperations}`);
  }
  lines.push(report.raidStage ? `Incident anti-raid activ, etapa: ${report.raidStage}` : "Niciun incident anti-raid activ.");

  return lines.join("\n");
}
