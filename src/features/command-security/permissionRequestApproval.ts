"use strict";

import { canonicalAction, canonicalTarget, isPermissionRequestType, normalizePermissionName } from "./permissionRequestTypes.js";

import type { ApprovalRestriction } from "./permissionRequestRepository.js";
import type { PermissionRequestRecord, PermissionRequestScope, PermissionRequestType } from "./permissionRequestTypes.js";

export const RESTRICTION_INPUT_IDS = {
  target: "permission-request-target",
  action: "permission-request-action",
  amount: "permission-request-amount",
  permissions: "permission-request-permissions",
  botId: "permission-request-bot",
  duration: "permission-request-duration"
} as const;

const DURATION_PATTERN = /^(\d+)\s*(m|h|d)$/i;
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export function parseDurationMs(value: string | undefined): number | null {
  const match = DURATION_PATTERN.exec(String(value ?? "").trim());
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2].toLowerCase();
  const factor = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  const total = amount * factor;
  return total > MAX_DURATION_MS ? MAX_DURATION_MS : total;
}

export function parsePermissionList(value: string | undefined): string[] {
  return String(value ?? "")
    .split(/[,+\s]+/)
    .map(entry => entry.trim())
    .filter(Boolean);
}

export function parseRequestType(value: string | undefined): PermissionRequestType | null {
  return isPermissionRequestType(value) ? value : null;
}

export function restrictionFromModal(
  record: PermissionRequestRecord,
  raw: { target?: string; action?: string; amount?: string; permissions?: string; botId?: string; duration?: string }
): ApprovalRestriction {
  const restriction: ApprovalRestriction = {};
  const target = canonicalTarget(String(raw.target ?? ""));
  const action = canonicalAction(String(raw.action ?? ""));
  if (target && target !== canonicalTarget(record.target)) restriction.target = target;
  if (action && action !== canonicalAction(record.action)) restriction.action = action;

  const amount = Number(String(raw.amount ?? "").trim());
  if (Number.isFinite(amount) && amount > 0) restriction.amount = amount;

  const permissions = parsePermissionList(raw.permissions);
  if (permissions.length > 0) restriction.permissions = permissions;

  const botId = String(raw.botId ?? "").trim();
  if (botId && botId !== record.botId) restriction.botId = botId;

  const ttlMs = parseDurationMs(raw.duration);
  if (ttlMs !== null) restriction.ttlMs = ttlMs;
  return restriction;
}

export function attemptFromRequest(record: PermissionRequestRecord): PermissionRequestScope {
  return {
    target: record.approvedTarget ?? record.target,
    action: record.approvedAction ?? record.action,
    amount: record.approvedAmount ?? record.amount ?? null,
    permissions: record.approvedPermissions ?? record.permissions,
    botId: record.approvedBotId ?? record.botId ?? null
  };
}

const NEWLINE = String.fromCharCode(10);

function describeValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "-";
  return String(value);
}

export function compareRequestedApproved(record: PermissionRequestRecord): string {
  const rows: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ["tinta", record.target, record.approvedTarget ?? record.target],
    ["actiune", record.action, record.approvedAction ?? record.action],
    ["cantitate", record.amount, record.approvedAmount ?? record.amount],
    ["permisiuni", record.permissions, record.approvedPermissions ?? record.permissions],
    ["bot executor", record.botId, record.approvedBotId ?? record.botId]
  ];

  const lines = rows.map(([label, requested, approved]) => {
    const left = describeValue(requested);
    const right = describeValue(approved);
    const marker = left === right ? "=" : "->";
    return `- ${label}: ${left} ${marker} ${right}`;
  });

  const narrowed = rows.some(([, requested, approved]) => describeValue(requested) !== describeValue(approved));
  return [narrowed ? "Cerut -> aprobat (restrans):" : "Cerut -> aprobat (neschimbat):", ...lines].join(NEWLINE);
}
