"use strict";

export interface ChannelSettingsLike {
  antiRaidAlertChannelId?: string | null;
  permissionRequestChannelId?: string | null;
  newAccountAlertChannelId?: string | null;
  threatAlertChannelId?: string | null;
  adAlertChannelId?: string | null;
}

export const PROTECTION_CHANNEL_FIELDS: Readonly<Record<string, readonly (keyof ChannelSettingsLike)[]>> = {
  "new-account-alerts": ["newAccountAlertChannelId"],
  "threat-protection": ["threatAlertChannelId"],
  "moderation-guard": ["permissionRequestChannelId"],
  "anti-raid": ["antiRaidAlertChannelId", "permissionRequestChannelId"],
  "anti-raid-dry-run": ["antiRaidAlertChannelId", "permissionRequestChannelId"],
  "ad-protection": ["adAlertChannelId"]
};

export function channelFieldsFor(protectionKey: string): readonly (keyof ChannelSettingsLike)[] {
  return PROTECTION_CHANNEL_FIELDS[protectionKey] ?? [];
}

export function resolveProtectionChannel(
  protectionKey: string,
  settings: ChannelSettingsLike | null | undefined
): string | null {
  for (const field of channelFieldsFor(protectionKey)) {
    const value = settings?.[field];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

export function usesFallbackChannel(
  protectionKey: string,
  settings: ChannelSettingsLike | null | undefined
): boolean {
  const fields = channelFieldsFor(protectionKey);
  if (fields.length < 2) return false;
  const primary = settings?.[fields[0]];
  return !(typeof primary === "string" && primary) && resolveProtectionChannel(protectionKey, settings) !== null;
}

export function describeChannelSource(protectionKey: string, settings: ChannelSettingsLike | null | undefined): string | null {
  if (!usesFallbackChannel(protectionKey, settings)) return null;
  return "foloseste canalul de cereri de securitate, fiindca nu are unul dedicat";
}
