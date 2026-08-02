"use strict";

export const PROTECTED_RESOURCE_TYPES = ["channel", "category", "role"] as const;
export type ProtectedResourceType = (typeof PROTECTED_RESOURCE_TYPES)[number];

export function isProtectedResourceType(value: string): value is ProtectedResourceType {
  return (PROTECTED_RESOURCE_TYPES as readonly string[]).includes(value);
}

export interface ProtectedOverwrite {
  id: string;
  type: number;
  allow: string;
  deny: string;
}

export interface ProtectedResourceSnapshot {
  name: string;
  position: number | null;
  parentId: string | null;
  topic: string | null;
  nsfw: boolean | null;
  rateLimitPerUser: number | null;
  bitrate: number | null;
  userLimit: number | null;
  channelType: number | null;
  permissions: string | null;
  color: number | null;
  hoist: boolean | null;
  mentionable: boolean | null;
  overwrites: ProtectedOverwrite[];
}

export interface ProtectedResourceRecord {
  _id: string;
  guildId: string;
  resourceId: string;
  type: ProtectedResourceType;
  addedBy: string;
  addedAt: Date;
  snapshot: ProtectedResourceSnapshot;
  snapshotAt: Date;
  degraded: boolean;
  degradedReasons: string[];
  preventionApplied: boolean;
  preventionTargets?: readonly { id: string; previous: string }[];
  lastRestoredAt: Date | null;
  recreatedFromId: string | null;
  deletedDuringRaidAt?: Date | null;
  ownerInterventionAt?: Date | null;
}

export const RESOURCE_CHANGE_ACTIONS = ["delete", "rename", "move", "reposition", "permissions"] as const;
export type ResourceChangeAction = (typeof RESOURCE_CHANGE_ACTIONS)[number];

export function emptySnapshot(): ProtectedResourceSnapshot {
  return {
    name: "",
    position: null,
    parentId: null,
    topic: null,
    nsfw: null,
    rateLimitPerUser: null,
    bitrate: null,
    userLimit: null,
    channelType: null,
    permissions: null,
    color: null,
    hoist: null,
    mentionable: null,
    overwrites: []
  };
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function bitfieldText(value: unknown): string | null {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value && typeof value === "object") {
    const bitfield = (value as { bitfield?: unknown }).bitfield;
    if (bitfield !== undefined && bitfield !== value) return bitfieldText(bitfield);
  }
  return null;
}

export interface ResourceLike {
  name?: unknown;
  position?: unknown;
  rawPosition?: unknown;
  parentId?: unknown;
  topic?: unknown;
  nsfw?: unknown;
  rateLimitPerUser?: unknown;
  bitrate?: unknown;
  userLimit?: unknown;
  type?: unknown;
  permissions?: unknown;
  color?: unknown;
  hoist?: unknown;
  mentionable?: unknown;
  permissionOverwrites?: { cache?: { values?: () => Iterable<unknown> } };
}

export function captureSnapshot(resource: ResourceLike): ProtectedResourceSnapshot {
  const overwrites: ProtectedOverwrite[] = [];
  const values = resource.permissionOverwrites?.cache?.values?.();
  for (const entry of values ?? []) {
    const overwrite = entry as { id?: unknown; type?: unknown; allow?: unknown; deny?: unknown };
    if (typeof overwrite.id !== "string") continue;
    overwrites.push({
      id: overwrite.id,
      type: optionalNumber(overwrite.type) ?? 0,
      allow: bitfieldText(overwrite.allow) ?? "0",
      deny: bitfieldText(overwrite.deny) ?? "0"
    });
  }
  return {
    name: typeof resource.name === "string" ? resource.name : "",
    position: optionalNumber(resource.rawPosition) ?? optionalNumber(resource.position),
    parentId: optionalText(resource.parentId),
    topic: optionalText(resource.topic),
    nsfw: optionalBoolean(resource.nsfw),
    rateLimitPerUser: optionalNumber(resource.rateLimitPerUser),
    bitrate: optionalNumber(resource.bitrate),
    userLimit: optionalNumber(resource.userLimit),
    channelType: optionalNumber(resource.type),
    permissions: bitfieldText(resource.permissions),
    color: optionalNumber(resource.color),
    hoist: optionalBoolean(resource.hoist),
    mentionable: optionalBoolean(resource.mentionable),
    overwrites: overwrites.sort((left, right) => left.id.localeCompare(right.id))
  };
}

export function diffSnapshot(
  previous: ProtectedResourceSnapshot,
  current: ProtectedResourceSnapshot
): ResourceChangeAction[] {
  const actions: ResourceChangeAction[] = [];
  if (previous.name !== current.name) actions.push("rename");
  if (previous.parentId !== current.parentId) actions.push("move");
  if (previous.position !== current.position) actions.push("reposition");
  if (previous.permissions !== current.permissions || overwritesDiffer(previous.overwrites, current.overwrites)) {
    actions.push("permissions");
  }
  return actions;
}

function overwritesDiffer(previous: readonly ProtectedOverwrite[], current: readonly ProtectedOverwrite[]): boolean {
  if (previous.length !== current.length) return true;
  for (let index = 0; index < previous.length; index += 1) {
    const before = previous[index];
    const after = current[index];
    if (before.id !== after.id || before.type !== after.type || before.allow !== after.allow || before.deny !== after.deny) {
      return true;
    }
  }
  return false;
}
