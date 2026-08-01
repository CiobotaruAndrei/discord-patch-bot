"use strict";

import type { PermissionRequestRecord, PermissionRequestStatus } from "../command-security/permissionRequestTypes.js";

const STATUS_LABELS: Record<PermissionRequestStatus, string> = {
  pending: "in asteptare",
  approved: "aprobata",
  rejected: "respinsa",
  used: "folosita",
  expired: "expirata",
  cancelled: "anulata"
};

function relTime(value: Date | string | null | undefined): string {
  return value ? `<t:${Math.floor(new Date(value).getTime() / 1000)}:R>` : "-";
}

function scopeText(record: PermissionRequestRecord): string {
  const parts = [`tinta ${record.target || "-"}`, `actiune ${record.action || "-"}`];
  if (typeof record.amount === "number") parts.push(`cantitate ${record.amount}`);
  if (record.permissions?.length) parts.push(`permisiuni ${record.permissions.join("+")}`);
  if (record.botId) parts.push(`bot ${record.botId}`);
  return parts.join(" | ");
}

function approvedText(record: PermissionRequestRecord): string {
  const parts: string[] = [];
  if (record.approvedTarget) parts.push(`tinta ${record.approvedTarget}`);
  if (record.approvedAction) parts.push(`actiune ${record.approvedAction}`);
  if (typeof record.approvedAmount === "number") parts.push(`cantitate ${record.approvedAmount}`);
  if (record.approvedPermissions?.length) parts.push(`permisiuni ${record.approvedPermissions.join("+")}`);
  return parts.length ? ` | aprobat: ${parts.join(", ")}` : "";
}

export function displayPermissionRequest(record: PermissionRequestRecord): string {
  const respondedBy = record.ownerId ? ` de <@${record.ownerId}>` : "";
  return `#${record._id} | tip ${record.type} | solicitant <@${record.requesterId}> | ${scopeText(record)}`
    + `${approvedText(record)} | motiv ${record.reason || "-"} | status ${STATUS_LABELS[record.status]}`
    + ` | cerut ${relTime(record.requestedAt)} | raspuns ${relTime(record.respondedAt)}${respondedBy}`
    + ` | expira ${relTime(record.expiresAt)} | folosit ${relTime(record.usedAt)}`;
}

export function isActivePermissionRequest(record: PermissionRequestRecord, now: number): boolean {
  return (record.status === "pending" || record.status === "approved")
    && Boolean(record.expiresAt && new Date(record.expiresAt).getTime() > now);
}

export function orderPermissionRequests(records: readonly PermissionRequestRecord[], now: number): PermissionRequestRecord[] {
  return [...records].sort((left, right) => {
    const activeDelta = (isActivePermissionRequest(right, now) ? 1 : 0) - (isActivePermissionRequest(left, now) ? 1 : 0);
    if (activeDelta !== 0) return activeDelta;
    return new Date(right.requestedAt).getTime() - new Date(left.requestedAt).getTime();
  });
}

export function permissionRequestButtons(requestId: string): unknown[] {
  return [{
    type: 1,
    components: [
      { type: 2, style: 3, label: "Aproba", custom_id: `permission-request:approve:${requestId}` },
      { type: 2, style: 4, label: "Respinge", custom_id: `permission-request:reject:${requestId}` }
    ]
  }];
}
