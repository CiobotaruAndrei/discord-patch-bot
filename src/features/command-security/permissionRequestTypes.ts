"use strict";

export const PERMISSION_REQUEST_TYPES = [
  "bot-add",
  "permission-grant",
  "moderation-mass",
  "webhook",
  "server-structure",
  "protected-resource-change"
] as const;

export type PermissionRequestType = (typeof PERMISSION_REQUEST_TYPES)[number];

export const PERMISSION_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "used",
  "expired",
  "cancelled"
] as const;

export type PermissionRequestStatus = (typeof PERMISSION_REQUEST_STATUSES)[number];

export interface PermissionRequestScope {
  target: string;
  action: string;
  resourceKind?: string | null;
  amount?: number | null;
  permissions?: string[];
  botId?: string | null;
  approvedBotId?: string | null;
}

export interface PermissionRequestRecord extends PermissionRequestScope {
  _id: string;
  guildId: string;
  type: PermissionRequestType;
  requesterId: string;
  reason: string;
  status: PermissionRequestStatus;
  approvedTarget?: string | null;
  approvedAction?: string | null;
  approvedAmount?: number | null;
  approvedPermissions?: string[];
  ownerId?: string | null;
  requestedAt: Date;
  respondedAt?: Date | null;
  usedAt?: Date | null;
  cancelReason?: string | null;
  claimBatchId?: string | null;
  expiresAt?: Date | null;
  remainingAmount?: number | null;
  resourceKind?: string | null;
}

const OPTIONAL_FIELDS_BY_TYPE: Record<PermissionRequestType, ReadonlyArray<keyof PermissionRequestScope>> = {
  "bot-add": ["botId"],
  "permission-grant": ["permissions", "botId"],
  "moderation-mass": ["amount", "botId"],
  webhook: ["botId"],
  "server-structure": ["amount", "botId"],
  "protected-resource-change": ["permissions", "botId"]
};

export function isPermissionRequestType(value: unknown): value is PermissionRequestType {
  return typeof value === "string" && (PERMISSION_REQUEST_TYPES as readonly string[]).includes(value);
}

export function isPermissionRequestStatus(value: unknown): value is PermissionRequestStatus {
  return typeof value === "string" && (PERMISSION_REQUEST_STATUSES as readonly string[]).includes(value);
}

export function appliesToType(type: PermissionRequestType, field: keyof PermissionRequestScope): boolean {
  if (field === "target" || field === "action") return true;
  return OPTIONAL_FIELDS_BY_TYPE[type].includes(field);
}

export function canonicalScope(type: PermissionRequestType, scope: PermissionRequestScope): PermissionRequestScope {
  const canonical: PermissionRequestScope = { target: scope.target.trim(), action: scope.action.trim().toLowerCase() };
  if (appliesToType(type, "amount") && typeof scope.amount === "number") canonical.amount = scope.amount;
  if (appliesToType(type, "permissions") && scope.permissions?.length) {
    canonical.permissions = [...new Set(scope.permissions.map(normalizePermissionName))].sort();
  }
  if (appliesToType(type, "botId") && scope.botId) canonical.botId = scope.botId;
  return canonical;
}

export function scopeFingerprint(type: PermissionRequestType, scope: PermissionRequestScope): string {
  const canonical = canonicalScope(type, scope);
  return [
    type,
    canonical.target,
    canonical.action,
    canonical.amount ?? "",
    (canonical.permissions ?? []).join("+"),
    canonical.botId ?? ""
  ].join("|");
}

export function stripInapplicableFields(type: PermissionRequestType, scope: PermissionRequestScope): PermissionRequestScope {
  const kept: PermissionRequestScope = { target: scope.target, action: scope.action };
  if (appliesToType(type, "amount") && typeof scope.amount === "number") kept.amount = scope.amount;
  if (appliesToType(type, "permissions") && scope.permissions?.length) kept.permissions = [...scope.permissions];
  if (appliesToType(type, "botId") && scope.botId) kept.botId = scope.botId;
  return kept;
}

export function normalizePermissionName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export const BATCH_TARGET_PREFIX = "lot:";

export function batchTarget(resourceKind: string): string {
  return `${BATCH_TARGET_PREFIX}${resourceKind}`;
}

export function isBatchApproval(record: PermissionRequestRecord): boolean {
  const target = record.approvedTarget ?? record.target;
  return target.startsWith(BATCH_TARGET_PREFIX);
}

export function batchCapacity(record: PermissionRequestRecord): number {
  if (typeof record.remainingAmount === "number") return record.remainingAmount;
  return record.approvedAmount ?? record.amount ?? 0;
}

export function scopeMatchesApproval(record: PermissionRequestRecord, attempt: PermissionRequestScope): boolean {
  const target = record.approvedTarget ?? record.target;
  const action = record.approvedAction ?? record.action;
  if (action !== attempt.action) return false;

  if (target.startsWith(BATCH_TARGET_PREFIX)) {
    if (attempt.resourceKind === undefined || attempt.resourceKind === null) return false;
    if (batchTarget(attempt.resourceKind) !== target) return false;
    return batchCapacity(record) > 0;
  }

  if (attempt.target !== target) return false;

  const approvedBot = record.approvedBotId ?? record.botId ?? null;
  if (approvedBot !== (attempt.botId ?? null)) return false;

  const attemptedAmount = attempt.amount ?? 0;
  const approvedAmount = record.approvedAmount ?? record.amount ?? null;
  if (attemptedAmount > 0 && approvedAmount === null) return false;
  if (approvedAmount !== null && attemptedAmount > approvedAmount) return false;

  const attemptedPermissions = attempt.permissions ?? [];
  const approvedPermissions = record.approvedPermissions ?? record.permissions ?? [];
  if (attemptedPermissions.length > 0) {
    if (approvedPermissions.length === 0) return false;
    const allowed = new Set(approvedPermissions.map(normalizePermissionName));
    if (attemptedPermissions.some(permission => !allowed.has(normalizePermissionName(permission)))) return false;
  }
  return true;
}
