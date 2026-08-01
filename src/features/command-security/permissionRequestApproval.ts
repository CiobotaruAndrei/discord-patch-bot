"use strict";

import { isPermissionRequestType, normalizePermissionName } from "./permissionRequestTypes.js";

import type { ApprovalRestriction } from "./permissionRequestRepository.js";
import type { PermissionRequestRecord, PermissionRequestScope, PermissionRequestType } from "./permissionRequestTypes.js";

export const RESTRICTION_INPUT_IDS = {
  target: "permission-request-target",
  action: "permission-request-action",
  amount: "permission-request-amount",
  permissions: "permission-request-permissions",
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
  raw: { target?: string; action?: string; amount?: string; permissions?: string; duration?: string }
): ApprovalRestriction {
  const restriction: ApprovalRestriction = {};
  const target = String(raw.target ?? "").trim();
  const action = String(raw.action ?? "").trim();
  if (target && target !== record.target) restriction.target = target;
  if (action && action !== record.action) restriction.action = action;

  const amount = Number(String(raw.amount ?? "").trim());
  if (Number.isFinite(amount) && amount > 0) {
    const requested = typeof record.amount === "number" ? record.amount : amount;
    restriction.amount = Math.min(amount, requested);
  }

  const permissions = parsePermissionList(raw.permissions);
  if (permissions.length > 0) {
    const requested = new Set((record.permissions ?? []).map(normalizePermissionName));
    restriction.permissions = requested.size > 0
      ? permissions.filter(permission => requested.has(normalizePermissionName(permission)))
      : permissions;
  }

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
    botId: record.botId ?? null
  };
}
