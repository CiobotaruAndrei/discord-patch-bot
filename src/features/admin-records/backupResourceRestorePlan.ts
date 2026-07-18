"use strict";

export const BACKUP_CHANNEL_REFERENCE_FIELDS: readonly string[] = Object.freeze([
  "notificationChannelId",
  "discountChannelId",
  "adminAlertChannelId",
  "youtubeNotificationChannelId",
  "playerCountChannelId",
  "futureReleaseChannelId",
  "dlcChannelId"
]);

export interface ChannelReference {
  field: string;
  oldId: string;
}

export interface BackupChannelRestorePlan {
  missing: ChannelReference[];
  present: ChannelReference[];
}

export function planBackupChannelRestore(
  snapshot: Record<string, unknown> | null | undefined,
  existingChannelIds: Iterable<string>,
  channelFields: readonly string[] = BACKUP_CHANNEL_REFERENCE_FIELDS
): BackupChannelRestorePlan {
  const existing = new Set<string>();
  for (const id of existingChannelIds) existing.add(String(id));
  const missing: ChannelReference[] = [];
  const present: ChannelReference[] = [];
  for (const field of channelFields) {
    const value = snapshot?.[field];
    if (typeof value !== "string" || value.length === 0) continue;
    (existing.has(value) ? present : missing).push({ field, oldId: value });
  }
  return { missing, present };
}

export function applyChannelIdRemap(
  snapshot: Record<string, unknown> | null | undefined,
  remap: ReadonlyMap<string, string>,
  channelFields: readonly string[] = BACKUP_CHANNEL_REFERENCE_FIELDS
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(snapshot ?? {}) };
  for (const field of channelFields) {
    const value = next[field];
    if (typeof value === "string" && remap.has(value)) {
      next[field] = remap.get(value);
    }
  }
  return next;
}

export default { BACKUP_CHANNEL_REFERENCE_FIELDS, planBackupChannelRestore, applyChannelIdRemap };
