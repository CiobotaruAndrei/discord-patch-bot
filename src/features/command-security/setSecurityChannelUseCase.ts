"use strict";

export type ChannelPermissionsSnapshot = {
  viewChannel?: boolean;
  sendMessages?: boolean;
  embedLinks?: boolean;
} | null | undefined;

export type SetSecurityChannelOutcome =
  | { kind: "invalid-channel" }
  | { kind: "missing-permissions"; missing: readonly string[] }
  | { kind: "saved"; field: string }
  | { kind: "save-failed"; error: unknown };

export type SetSecurityChannelInput = {
  guildId: string;
  field: string | undefined;
  channelId: string | undefined;
};

export type SetSecurityChannelDeps = {
  readPermissions: (channelId: string) => Promise<ChannelPermissionsSnapshot>;
  persist: (guildId: string, field: string, channelId: string) => Promise<void>;
};

export const REQUIRED_CHANNEL_PERMISSIONS = [
  { key: "viewChannel", label: "View Channel" },
  { key: "sendMessages", label: "Send Messages" },
  { key: "embedLinks", label: "Embed Links" }
] as const;

export function missingChannelPermissions(permissions: ChannelPermissionsSnapshot): readonly string[] {
  if (!permissions) return REQUIRED_CHANNEL_PERMISSIONS.map(entry => entry.label);
  return REQUIRED_CHANNEL_PERMISSIONS
    .filter(entry => permissions[entry.key] !== true)
    .map(entry => entry.label);
}

export async function setSecurityChannel(
  input: SetSecurityChannelInput,
  deps: SetSecurityChannelDeps
): Promise<SetSecurityChannelOutcome> {
  if (!input.field || !input.channelId) return { kind: "invalid-channel" };

  const permissions = await deps.readPermissions(input.channelId);
  const missing = missingChannelPermissions(permissions);
  if (missing.length > 0) return { kind: "missing-permissions", missing };

  try {
    await deps.persist(input.guildId, input.field, input.channelId);
    return { kind: "saved", field: input.field };
  } catch (error: unknown) {
    return { kind: "save-failed", error };
  }
}
