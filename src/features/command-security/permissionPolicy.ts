"use strict";

export type DiscordPermission = "View Channel" | "Send Messages" | "Embed Links" | "Read Message History" | "Manage Messages" | "Manage Channels" | "Kick Members" | "Ban Members" | "Moderate Members";

export type ChannelPermissionSnapshot = Partial<Record<DiscordPermission, boolean>>;

export function missingPermissions(snapshot: ChannelPermissionSnapshot | null | undefined, required: readonly DiscordPermission[]): DiscordPermission[] {
  if (!snapshot) return [];
  return required.filter(permission => snapshot[permission] !== true);
}

export function missingPermissionsMessage(snapshot: ChannelPermissionSnapshot | null | undefined, required: readonly DiscordPermission[]): string | null {
  const missing = missingPermissions(snapshot, required);
  return missing.length ? `Eroare: lipsesc permisiuni Discord: ${missing.join(", ")}.` : null;
}
