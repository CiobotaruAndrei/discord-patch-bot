"use strict";

export const STRUCTURE_CHANGE_KINDS = ["channelCreate", "channelDelete", "roleCreate", "roleDelete"] as const;

export type StructureChangeKind = (typeof STRUCTURE_CHANGE_KINDS)[number];

export const STRUCTURE_ACTIONS: Readonly<Record<StructureChangeKind, string>> = {
  channelCreate: "create",
  channelDelete: "delete",
  roleCreate: "create",
  roleDelete: "delete"
};

export const STRUCTURE_APPROVAL_ACTIONS: readonly string[] = [...new Set(Object.values(STRUCTURE_ACTIONS))].sort();

export const STRUCTURE_RESOURCE_KINDS: Readonly<Record<StructureChangeKind, string>> = {
  channelCreate: "channel",
  channelDelete: "channel",
  roleCreate: "role",
  roleDelete: "role"
};

export const STRUCTURE_APPROVAL_RESOURCE_KINDS: readonly string[] =
  [...new Set(Object.values(STRUCTURE_RESOURCE_KINDS))].sort();
