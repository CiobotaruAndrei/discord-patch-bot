"use strict";

import { PermissionFlagsBits } from "discord.js";

type PermissionSet = { has(flag: bigint): boolean };

export interface BotRiskRoleLike {
  id: string;
  name?: string;
  position?: number;
  permissions?: PermissionSet;
}

export interface BotRiskInput {
  createdTimestamp?: number;
  verifiedBot?: boolean;
  approved?: boolean;
  roles?: readonly BotRiskRoleLike[];
  guildRoleCount?: number;
}

export interface BotRiskAssessment {
  level: "normal" | "suspicious" | "dangerous";
  score: number;
  signals: string[];
}

const DAY_MS = 86_400_000;
const DANGEROUS_SCORE = 5;
const SUSPICIOUS_SCORE = 2;

const PERMISSION_SIGNALS = [
  { flag: PermissionFlagsBits.Administrator, label: "Administrator", weight: 3 },
  { flag: PermissionFlagsBits.ManageWebhooks, label: "Manage Webhooks", weight: 2 },
  { flag: PermissionFlagsBits.BanMembers, label: "Ban Members", weight: 2 },
  { flag: PermissionFlagsBits.KickMembers, label: "Kick Members", weight: 2 },
  { flag: PermissionFlagsBits.ModerateMembers, label: "Moderate Members", weight: 2 },
  { flag: PermissionFlagsBits.ManageRoles, label: "Manage Roles", weight: 1 },
  { flag: PermissionFlagsBits.ManageChannels, label: "Manage Channels", weight: 1 }
] as const;

export function assessBotRisk(input: BotRiskInput, now: number): BotRiskAssessment {
  let score = 0;
  const signals: string[] = [];
  const created = input.createdTimestamp;
  if (typeof created !== "number" || !Number.isFinite(created)) {
    score += 2;
    signals.push("varsta contului necunoscuta (+2)");
  } else {
    const age = now - created;
    if (age < DAY_MS) {
      score += 3;
      signals.push("cont creat in ultimele 24 de ore (+3)");
    } else if (age < 30 * DAY_MS) {
      score += 2;
      signals.push("cont mai nou de 30 de zile (+2)");
    } else if (age < 90 * DAY_MS) {
      score += 1;
      signals.push("cont mai nou de 90 de zile (+1)");
    }
  }
  const roles = input.roles ?? [];
  for (const signal of PERMISSION_SIGNALS) {
    if (roles.some(role => role.permissions?.has(signal.flag) === true)) {
      score += signal.weight;
      signals.push(`permisiune ${signal.label} (+${signal.weight})`);
    }
  }
  const guildRoleCount = input.guildRoleCount ?? 0;
  const maxPosition = roles.reduce((position, role) => Math.max(position, role.position ?? 0), 0);
  if (guildRoleCount > 2 && maxPosition > guildRoleCount / 2) {
    score += 1;
    signals.push("rol pozitionat in jumatatea superioara a ierarhiei (+1)");
  }
  if (input.verifiedBot === true) {
    score -= 2;
    signals.push("bot verificat de Discord (-2)");
  }
  if (input.approved === true) {
    score -= 1;
    signals.push("aprobare valida pentru intrare (-1)");
  }
  const level = score >= DANGEROUS_SCORE ? "dangerous" : score >= SUSPICIOUS_SCORE ? "suspicious" : "normal";
  return { level, score, signals };
}

export default { assessBotRisk };
