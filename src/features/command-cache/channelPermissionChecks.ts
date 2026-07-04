export interface PermissionsLike {
  has(permission: unknown): boolean;
}

export interface TextChannelLike {
  isTextBased(): boolean;
  permissionsFor(botId: string): PermissionsLike | null;
}

export interface PermissionsBitFieldLike {
  Flags: {
    ViewChannel: unknown;
    SendMessages: unknown;
    EmbedLinks: unknown;
  };
}

export interface RequiredChannelPerm {
  flag: unknown;
  label: string;
}

export function isTextChannelLikeValue(channel: unknown): channel is TextChannelLike {
  return Boolean(channel)
    && typeof (channel as { isTextBased?: unknown }).isTextBased === "function"
    && typeof (channel as { permissionsFor?: unknown }).permissionsFor === "function";
}

export function requiredNotifyPerms(PermissionsBitField: PermissionsBitFieldLike): RequiredChannelPerm[] {
  return [
    { flag: PermissionsBitField.Flags.ViewChannel, label: "View Channel" },
    { flag: PermissionsBitField.Flags.SendMessages, label: "Send Messages" },
    { flag: PermissionsBitField.Flags.EmbedLinks, label: "Embed Links" }
  ];
}

export function computeMissingChannelPerms(channel: unknown, botId: string, PermissionsBitField: PermissionsBitFieldLike): string[] | null {
  if (!isTextChannelLikeValue(channel) || !channel.isTextBased()) return null;
  const perms = channel.permissionsFor(botId);
  if (!perms) return null;
  return requiredNotifyPerms(PermissionsBitField).filter(perm => !perms.has(perm.flag)).map(perm => perm.label);
}

export function formatMissingChannelPerms(missing: string[] | null | undefined): string {
  if (missing && missing.length > 0) {
    return `Eroare: Nu pot activa notificarile pe acest canal. Lipsesc permisiunile: ${missing.map(label => `**${label}**`).join(", ")}. Adauga-le rolului botului pe acest canal si reincearca.`;
  }
  return "Eroare: Nu pot activa notificarile pe acest canal. Am nevoie de **View Channel**, **Send Messages** si **Embed Links**.";
}

export interface ChannelPermissionChecksDeps {
  PermissionsBitField: PermissionsBitFieldLike;
}

export function createChannelPermissionChecks({ PermissionsBitField }: ChannelPermissionChecksDeps) {
  function canSendEmbeds(channel: unknown, botId: string): boolean {
    if (!isTextChannelLikeValue(channel) || !channel.isTextBased()) return false;
    const perms = channel.permissionsFor(botId);
    return !!perms && perms.has([
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.EmbedLinks
    ]);
  }

  function listMissingChannelPerms(channel: unknown, botId: string): string[] | null {
    return computeMissingChannelPerms(channel, botId, PermissionsBitField);
  }

  function missingChannelPermsMessage(missing?: string[] | null): string {
    return formatMissingChannelPerms(missing);
  }

  return { canSendEmbeds, listMissingChannelPerms, missingChannelPermsMessage };
}
