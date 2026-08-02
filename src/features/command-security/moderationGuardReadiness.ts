"use strict";

import { PermissionFlagsBits } from "discord.js";
import { MODERATION_GUARD_TYPES } from "./moderationGuardDecision.js";

import type { PermissionRequestType } from "./permissionRequestTypes.js";

export type SubprotectionState = "ready" | "degraded" | "blocked";

export interface SubprotectionReadiness {
  type: PermissionRequestType;
  state: SubprotectionState;
  missing: string[];
  blocking: string[];
}

export interface PermissionHolder {
  permissions?: { has(flag: bigint): boolean } | null;
  roles?: { highest?: { position?: number } | null } | null;
}

interface Requirement {
  flag: bigint;
  label: string;
}

interface SubprotectionRequirements {
  blocking: readonly Requirement[];
  degrading: readonly Requirement[];
  hierarchyBlocks: boolean;
}

const AUDIT: Requirement = { flag: PermissionFlagsBits.ViewAuditLog, label: "View Audit Log" };
const ROLES: Requirement = { flag: PermissionFlagsBits.ManageRoles, label: "Manage Roles" };
const CHANNELS: Requirement = { flag: PermissionFlagsBits.ManageChannels, label: "Manage Channels" };
const WEBHOOKS: Requirement = { flag: PermissionFlagsBits.ManageWebhooks, label: "Manage Webhooks" };
const KICK: Requirement = { flag: PermissionFlagsBits.KickMembers, label: "Kick Members" };
const BAN: Requirement = { flag: PermissionFlagsBits.BanMembers, label: "Ban Members" };

const REQUIREMENTS: Readonly<Record<PermissionRequestType, SubprotectionRequirements>> = {
  "bot-add": { blocking: [AUDIT, KICK], degrading: [], hierarchyBlocks: true },
  "permission-grant": { blocking: [AUDIT], degrading: [ROLES], hierarchyBlocks: false },
  "moderation-mass": { blocking: [AUDIT], degrading: [BAN, ROLES], hierarchyBlocks: false },
  webhook: { blocking: [AUDIT], degrading: [WEBHOOKS, ROLES], hierarchyBlocks: false },
  "server-structure": { blocking: [AUDIT], degrading: [ROLES], hierarchyBlocks: false },
  "protected-resource-change": { blocking: [AUDIT], degrading: [CHANNELS, ROLES], hierarchyBlocks: false }
};

const HIERARCHY_GAP = "rol pozitionat deasupra rolului @everyone (necesar pentru sanctionarea autorului)";

function lacks(holder: PermissionHolder | null | undefined, requirement: Requirement): boolean {
  return holder?.permissions?.has(requirement.flag) !== true;
}

function outranksEveryone(holder: PermissionHolder | null | undefined): boolean {
  return (holder?.roles?.highest?.position ?? 0) > 0;
}

export function moderationGuardReadiness(holder: PermissionHolder | null | undefined): SubprotectionReadiness[] {
  return MODERATION_GUARD_TYPES.map(type => {
    const requirements = REQUIREMENTS[type];
    const blockedBy = requirements.blocking.filter(requirement => lacks(holder, requirement));
    const degradedBy = requirements.degrading.filter(requirement => lacks(holder, requirement));
    if (!outranksEveryone(holder)) {
      (requirements.hierarchyBlocks ? blockedBy : degradedBy).push({ flag: 0n, label: HIERARCHY_GAP });
    }

    const missing = [...blockedBy, ...degradedBy].map(requirement => requirement.label);
    const blocking = blockedBy.map(requirement => requirement.label);
    if (blocking.length > 0) return { type, state: "blocked", missing, blocking };
    return { type, state: degradedBy.length > 0 ? "degraded" : "ready", missing, blocking };
  });
}

export function blockingGaps(report: readonly SubprotectionReadiness[]): string[] {
  return [...new Set(report.flatMap(entry => entry.blocking))];
}

export function degradedSubprotections(report: readonly SubprotectionReadiness[]): SubprotectionReadiness[] {
  return report.filter(entry => entry.state === "degraded");
}

export function describeGuardReadiness(report: readonly SubprotectionReadiness[]): string {
  const blocked = report.filter(entry => entry.state === "blocked");
  const degraded = degradedSubprotections(report);
  if (blocked.length === 0 && degraded.length === 0) return "Toate cele sase subprotectii pot detecta si corecta.";

  const lines: string[] = [];
  if (blocked.length > 0) {
    lines.push("Subprotectii BLOCATE (nu pot nici macar identifica autorul):");
    lines.push(...blocked.map(entry => `- ${entry.type}: lipseste ${entry.blocking.join(", ")}`));
  }
  if (degraded.length > 0) {
    lines.push("Subprotectii pornite dar degradate (detecteaza si alerteaza, dar NU pot corecta):");
    lines.push(...degraded.map(entry => `- ${entry.type}: lipseste ${entry.missing.join(", ")}`));
  }
  return lines.join("\n");
}

export function readinessGapsByProtection(
  report: readonly SubprotectionReadiness[]
): Record<string, readonly string[]> {
  const gaps: Record<string, readonly string[]> = {};
  for (const entry of report) {
    if (entry.missing.length > 0) gaps[entry.type] = entry.missing;
  }
  const guardGaps = [...new Set(report.flatMap(entry => entry.missing))];
  if (guardGaps.length > 0) gaps["moderation-guard"] = guardGaps;
  return gaps;
}
