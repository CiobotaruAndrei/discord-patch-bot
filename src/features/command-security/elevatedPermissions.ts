"use strict";

import { PermissionFlagsBits } from "discord.js";

export type ElevatedSurface = "role" | "member" | "overwrite";

export interface ElevatedPermission {
  name: string;
  flag: bigint;
  label: string;
  surfaces: readonly ElevatedSurface[];
}

const ROLE_AND_MEMBER: readonly ElevatedSurface[] = ["role", "member"];
const EVERY_SURFACE: readonly ElevatedSurface[] = ["role", "member", "overwrite"];

export const ELEVATED_PERMISSIONS = [
  { name: "Administrator", flag: PermissionFlagsBits.Administrator, label: "Administrator", surfaces: ROLE_AND_MEMBER },
  { name: "ManageGuild", flag: PermissionFlagsBits.ManageGuild, label: "Manage Guild", surfaces: ROLE_AND_MEMBER },
  { name: "ManageRoles", flag: PermissionFlagsBits.ManageRoles, label: "Manage Roles", surfaces: EVERY_SURFACE },
  { name: "ManageChannels", flag: PermissionFlagsBits.ManageChannels, label: "Manage Channels", surfaces: EVERY_SURFACE },
  { name: "ManageWebhooks", flag: PermissionFlagsBits.ManageWebhooks, label: "Manage Webhooks", surfaces: EVERY_SURFACE },
  { name: "BanMembers", flag: PermissionFlagsBits.BanMembers, label: "Ban Members", surfaces: ROLE_AND_MEMBER },
  { name: "KickMembers", flag: PermissionFlagsBits.KickMembers, label: "Kick Members", surfaces: ROLE_AND_MEMBER },
  { name: "ModerateMembers", flag: PermissionFlagsBits.ModerateMembers, label: "Moderate Members", surfaces: ROLE_AND_MEMBER }
] as const satisfies readonly ElevatedPermission[];

export type ElevatedPermissionName = (typeof ELEVATED_PERMISSIONS)[number]["name"];

export function elevatedOn(surface: ElevatedSurface): readonly ElevatedPermission[] {
  return ELEVATED_PERMISSIONS.filter(entry => entry.surfaces.includes(surface));
}

export const ELEVATED_PERMISSION_FLAGS: readonly ElevatedPermissionName[] =
  ELEVATED_PERMISSIONS.map(entry => entry.name);

export function labelOf(name: string): string {
  return ELEVATED_PERMISSIONS.find(entry => entry.name === name)?.label ?? name;
}
