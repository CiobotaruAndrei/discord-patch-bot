"use strict";

import { recordServerAuditEntry, type GuildAuditLogModelLike } from "../admin-records/auditLogRepository.js";

type NamedResource = { id?: string | null; name?: string | null; type?: string | number | null } | null | undefined;
type EventUser = { id?: string | null; tag?: string | null; username?: string | null } | null | undefined;
type GuildRef = { guild?: { id?: string | null } | null } | null | undefined;

export interface ServerEventLogDeps {
  GuildAuditLogModel: GuildAuditLogModelLike;
  logger?: (level: string, context: string, message: string, meta?: unknown) => void;
}

function labelResource(resource: NamedResource): string {
  return `${resource?.name ?? "necunoscut"} (${resource?.id ?? "?"})`;
}

function labelUser(user: EventUser): string {
  const name = user?.tag ?? user?.username;
  return name ? `${name} (${user?.id ?? "?"})` : `${user?.id ?? "necunoscut"}`;
}

function guildId(source: GuildRef): string {
  return String(source?.guild?.id ?? "");
}

export function createServerEventLogRuntime(deps: ServerEventLogDeps) {
  async function record(id: string, action: string, userId: string, details: string): Promise<void> {
    if (!id) return;
    try {
      await recordServerAuditEntry(deps.GuildAuditLogModel, id, { userId, action, details });
    } catch (err) {
      deps.logger?.("ERROR", "SERVER_EVENT_LOG", `Nu am putut inregistra evenimentul ${action}`, err);
    }
  }

  return Object.freeze({
    handleChannelCreate: (channel: NamedResource & GuildRef) =>
      record(guildId(channel), "server-channel-created", "", `channel=${labelResource(channel)}; tip=${channel?.type ?? "?"}`),
    handleChannelDelete: (channel: NamedResource & GuildRef) =>
      record(guildId(channel), "server-channel-deleted", "", `channel=${labelResource(channel)}`),
    handleRoleCreate: (role: NamedResource & GuildRef) =>
      record(guildId(role), "server-role-created", "", `role=${labelResource(role)}`),
    handleRoleDelete: (role: NamedResource & GuildRef) =>
      record(guildId(role), "server-role-deleted", "", `role=${labelResource(role)}`),
    handleGuildBanAdd: (ban: { user?: EventUser } & GuildRef) =>
      record(guildId(ban), "server-ban-added", String(ban?.user?.id ?? ""), `user=${labelUser(ban?.user)}`),
    handleGuildBanRemove: (ban: { user?: EventUser } & GuildRef) =>
      record(guildId(ban), "server-ban-removed", String(ban?.user?.id ?? ""), `user=${labelUser(ban?.user)}`),
    handleGuildMemberRemove: (member: { user?: EventUser } & GuildRef) =>
      record(guildId(member), "server-member-left", String(member?.user?.id ?? ""), `user=${labelUser(member?.user)}`)
  });
}

export default { createServerEventLogRuntime };
