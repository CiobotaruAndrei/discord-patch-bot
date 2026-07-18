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

export const BACKUP_ROLE_REFERENCE_FIELDS: readonly string[] = Object.freeze([
  "notificationRoleId",
  "discountRoleId"
]);

export type BackupResourceKind = "channel" | "role";

export interface BackupResourceReference {
  field: string;
  kind: BackupResourceKind;
  oldId: string;
  path: string;
}

export interface BackupResourcePlanEntry {
  createName: string;
  kind: BackupResourceKind;
  oldId: string;
  references: BackupResourceReference[];
}

export interface InvalidBackupResourceReference {
  path: string;
  reason: string;
}

export interface BackupResourceRestorePlan {
  invalid: InvalidBackupResourceReference[];
  missing: BackupResourcePlanEntry[];
  present: BackupResourcePlanEntry[];
}

export interface BackupResourceIdRemap {
  channels: ReadonlyMap<string, string>;
  roles: ReadonlyMap<string, string>;
}

export interface ChannelReference {
  field: string;
  oldId: string;
}

export interface BackupChannelRestorePlan {
  missing: ChannelReference[];
  present: ChannelReference[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resourceName(kind: BackupResourceKind, oldId: string): string {
  const suffix = oldId.replace(/[^a-zA-Z0-9-]/g, "-").slice(-24) || "resource";
  return `restored-${kind}-${suffix}`.slice(0, 100);
}

function addReference(
  entries: Map<string, BackupResourcePlanEntry>,
  kind: BackupResourceKind,
  field: string,
  oldId: string,
  path: string
): void {
  const key = `${kind}:${oldId}`;
  const reference = { field, kind, oldId, path };
  const existing = entries.get(key);
  if (existing) {
    existing.references.push(reference);
    return;
  }
  entries.set(key, {
    createName: resourceName(kind, oldId),
    kind,
    oldId,
    references: [reference]
  });
}

function collectTopLevelReferences(
  snapshot: Record<string, unknown>,
  fields: readonly string[],
  kind: BackupResourceKind,
  entries: Map<string, BackupResourcePlanEntry>,
  invalid: InvalidBackupResourceReference[]
): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, field)) continue;
    const value = snapshot[field];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value !== "string") {
      invalid.push({ path: field, reason: "ID-ul resursei nu este text" });
      continue;
    }
    addReference(entries, kind, field, value, field);
  }
}

function collectYoutubeRouteReferences(
  snapshot: Record<string, unknown>,
  entries: Map<string, BackupResourcePlanEntry>,
  invalid: InvalidBackupResourceReference[]
): void {
  const routes = snapshot.youtubeChannelRoutes;
  if (routes === undefined || routes === null) return;
  if (!Array.isArray(routes)) {
    invalid.push({ path: "youtubeChannelRoutes", reason: "Lista rutelor YouTube nu este valida" });
    return;
  }
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
    const route = routes[routeIndex];
    const routePath = `youtubeChannelRoutes[${routeIndex}]`;
    if (!isRecord(route)) {
      invalid.push({ path: routePath, reason: "Ruta YouTube nu este un obiect" });
      continue;
    }
    const channelIds = route.discordChannelIds;
    if (channelIds === undefined || channelIds === null) continue;
    if (!Array.isArray(channelIds)) {
      invalid.push({ path: `${routePath}.discordChannelIds`, reason: "Lista canalelor Discord nu este valida" });
      continue;
    }
    for (let valueIndex = 0; valueIndex < channelIds.length; valueIndex++) {
      const value = channelIds[valueIndex];
      const path = `${routePath}.discordChannelIds[${valueIndex}]`;
      if (typeof value !== "string" || value.length === 0) {
        invalid.push({ path, reason: "ID-ul canalului Discord este invalid" });
        continue;
      }
      addReference(entries, "channel", "youtubeChannelRoutes", value, path);
    }
  }
}

export function collectBackupResourceReferences(
  snapshot: Record<string, unknown> | null | undefined
): { entries: BackupResourcePlanEntry[]; invalid: InvalidBackupResourceReference[] } {
  const source = snapshot ?? {};
  const entries = new Map<string, BackupResourcePlanEntry>();
  const invalid: InvalidBackupResourceReference[] = [];
  collectTopLevelReferences(source, BACKUP_CHANNEL_REFERENCE_FIELDS, "channel", entries, invalid);
  collectTopLevelReferences(source, BACKUP_ROLE_REFERENCE_FIELDS, "role", entries, invalid);
  collectYoutubeRouteReferences(source, entries, invalid);
  return { entries: [...entries.values()], invalid };
}

export function planBackupResourceRestore(
  snapshot: Record<string, unknown> | null | undefined,
  existingChannelIds: Iterable<string>,
  existingRoleIds: Iterable<string>
): BackupResourceRestorePlan {
  const channels = new Set(existingChannelIds);
  const roles = new Set(existingRoleIds);
  const collected = collectBackupResourceReferences(snapshot);
  const missing: BackupResourcePlanEntry[] = [];
  const present: BackupResourcePlanEntry[] = [];
  for (const entry of collected.entries) {
    const existing = entry.kind === "channel" ? channels : roles;
    (existing.has(entry.oldId) ? present : missing).push(entry);
  }
  return { invalid: collected.invalid, missing, present };
}

function cloneSnapshot(snapshot: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const serialized = JSON.stringify(snapshot ?? {});
  if (!serialized) return {};
  const parsed: Record<string, unknown> = JSON.parse(serialized);
  return parsed;
}

function remapYoutubeRoutes(snapshot: Record<string, unknown>, channels: ReadonlyMap<string, string>): void {
  const routes = snapshot.youtubeChannelRoutes;
  if (!Array.isArray(routes)) return;
  snapshot.youtubeChannelRoutes = routes.map(route => {
    if (!isRecord(route)) return route;
    const next = { ...route };
    if (!Array.isArray(route.discordChannelIds)) return next;
    next.discordChannelIds = route.discordChannelIds.map(value => {
      if (typeof value !== "string") return value;
      return channels.get(value) ?? value;
    });
    return next;
  });
}

export function applyResourceIdRemap(
  snapshot: Record<string, unknown> | null | undefined,
  remap: BackupResourceIdRemap
): Record<string, unknown> {
  const next = cloneSnapshot(snapshot);
  for (const field of BACKUP_CHANNEL_REFERENCE_FIELDS) {
    const value = next[field];
    if (typeof value === "string") next[field] = remap.channels.get(value) ?? value;
  }
  for (const field of BACKUP_ROLE_REFERENCE_FIELDS) {
    const value = next[field];
    if (typeof value === "string") next[field] = remap.roles.get(value) ?? value;
  }
  remapYoutubeRoutes(next, remap.channels);
  return next;
}

export function validateBackupResourceReferences(
  snapshot: Record<string, unknown> | null | undefined,
  existingChannelIds: Iterable<string>,
  existingRoleIds: Iterable<string>
): BackupResourceRestorePlan {
  return planBackupResourceRestore(snapshot, existingChannelIds, existingRoleIds);
}

export function planBackupChannelRestore(
  snapshot: Record<string, unknown> | null | undefined,
  existingChannelIds: Iterable<string>,
  channelFields: readonly string[] = BACKUP_CHANNEL_REFERENCE_FIELDS
): BackupChannelRestorePlan {
  const existing = new Set(existingChannelIds);
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
  const next = cloneSnapshot(snapshot);
  for (const field of channelFields) {
    const value = next[field];
    if (typeof value === "string") next[field] = remap.get(value) ?? value;
  }
  return next;
}

export default {
  BACKUP_CHANNEL_REFERENCE_FIELDS,
  BACKUP_ROLE_REFERENCE_FIELDS,
  applyChannelIdRemap,
  applyResourceIdRemap,
  collectBackupResourceReferences,
  planBackupChannelRestore,
  planBackupResourceRestore,
  validateBackupResourceReferences
};
