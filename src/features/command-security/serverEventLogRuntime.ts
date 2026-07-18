"use strict";

import { AuditLogEvent } from "discord.js";
import { recordServerAuditEntry, type GuildAuditLogModelLike } from "../admin-records/auditLogRepository.js";

type NamedResource = { id?: string | null; name?: string | null; type?: string | number | null } | null | undefined;
type EventUser = { id?: string | null; tag?: string | null; username?: string | null } | null | undefined;

interface ServerAuditEntry {
  id?: string;
  executor?: EventUser;
  target?: EventUser;
  createdTimestamp?: number;
}

interface ServerAuditEntries {
  find(predicate: (entry: ServerAuditEntry) => boolean): ServerAuditEntry | undefined;
}

interface AuditGuild {
  id?: string | null;
  fetchAuditLogs?(options: { type: AuditLogEvent; limit: number }): Promise<{ entries: ServerAuditEntries }>;
}

type GuildRef = { guild?: AuditGuild | null } | null | undefined;
type TimeoutMemberRef = { user?: EventUser; id?: string | null; communicationDisabledUntil?: Date | string | number | null } & { guild?: AuditGuild | null } | null | undefined;

function timeoutUntilMs(member: TimeoutMemberRef): number {
  const value = member?.communicationDisabledUntil;
  if (value === null || value === undefined) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

interface ModeratedTarget {
  action: "server-ban-added" | "server-member-kicked";
  actorId: string;
  auditId: string;
  at: number;
}

export interface ServerEventLogDeps {
  GuildAuditLogModel: GuildAuditLogModelLike;
  logger?: (level: string, context: string, message: string, meta?: unknown) => void;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  auditRetryDelaysMs?: readonly number[];
  memberRemoveDelayMs?: number;
  observeBotAction?: (guildId: string, actorId: string, auditEntryId: string, kind: string, at: Date) => Promise<unknown>;
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

function targetId(source: { user?: EventUser } | NamedResource): string {
  if (!source) return "";
  if ("user" in source) return String(source.user?.id ?? "");
  if ("id" in source) return String(source.id ?? "");
  return "";
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export function createServerEventLogRuntime(deps: ServerEventLogDeps) {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const retryDelays = deps.auditRetryDelaysMs ?? [0, 350, 900];
  const memberRemoveDelayMs = deps.memberRemoveDelayMs ?? 1_200;
  const moderatedTargets = new Map<string, ModeratedTarget>();

  function moderationKey(id: string, userId: string): string {
    return `${id}:${userId}`;
  }

  function rememberModeration(id: string, userId: string, event: ModeratedTarget): void {
    moderatedTargets.set(moderationKey(id, userId), event);
  }

  function recentModeration(id: string, userId: string): ModeratedTarget | null {
    const key = moderationKey(id, userId);
    const event = moderatedTargets.get(key);
    if (!event) return null;
    if (now() - event.at <= 30_000) return event;
    moderatedTargets.delete(key);
    return null;
  }

  async function findAuditEntry(source: GuildRef, type: AuditLogEvent, expectedTargetId: string): Promise<ServerAuditEntry | null> {
    const guild = source?.guild;
    if (!guild?.fetchAuditLogs || !expectedTargetId) return null;
    for (const delay of retryDelays) {
      if (delay > 0) await sleep(delay);
      try {
        const audit = await guild.fetchAuditLogs({ type, limit: 6 });
        const entry = audit.entries.find(candidate => {
          if (String(candidate.target?.id ?? "") !== expectedTargetId) return false;
          return candidate.createdTimestamp === undefined || Math.abs(now() - candidate.createdTimestamp) <= 20_000;
        });
        if (entry) return entry;
      } catch (error) {
        deps.logger?.("WARN", "SERVER_EVENT_LOG", `Audit Log indisponibil pentru ${String(type)}`, error);
      }
    }
    return null;
  }

  async function record(
    id: string,
    action: string,
    actorId: string,
    affectedId: string,
    details: string,
    auditId = ""
  ): Promise<void> {
    if (!id) return;
    const bucket = Math.floor(now() / 5_000);
    const operationId = auditId
      ? `server-event:${id}:audit:${auditId}`
      : `server-event:${id}:${action}:${affectedId || "none"}:${bucket}`;
    try {
      await recordServerAuditEntry(deps.GuildAuditLogModel, id, {
        userId: actorId,
        actorId,
        targetId: affectedId,
        action,
        details
      }, operationId);
    } catch (error) {
      deps.logger?.("ERROR", "SERVER_EVENT_LOG", `Nu am putut inregistra evenimentul ${action}`, error);
    }
    if (deps.observeBotAction && actorId && auditId) {
      try {
        await deps.observeBotAction(id, actorId, String(auditId), action, new Date(now()));
      } catch (error) {
        deps.logger?.("WARN", "SERVER_EVENT_LOG", `Nu am putut corela evenimentul ${action} cu profilul botului monitorizat`, error);
      }
    }
  }

  async function recordResourceEvent(source: NamedResource & GuildRef, type: AuditLogEvent, action: string, resourceKind: string): Promise<void> {
    const id = guildId(source);
    const affectedId = targetId(source);
    const audit = await findAuditEntry(source, type, affectedId);
    const actorId = String(audit?.executor?.id ?? "");
    const suffix = resourceKind === "channel" ? `; tip=${source?.type ?? "?"}` : "";
    await record(id, action, actorId, affectedId, `${resourceKind}=${labelResource(source)}; actor=${labelUser(audit?.executor)}${suffix}`, audit?.id);
  }

  async function recordModerationEvent(
    source: { user?: EventUser } & GuildRef,
    type: AuditLogEvent,
    action: "server-ban-added" | "server-ban-removed",
    remember: boolean
  ): Promise<void> {
    const id = guildId(source);
    const affectedId = targetId(source);
    if (remember) rememberModeration(id, affectedId, { action: "server-ban-added", actorId: "", auditId: "", at: now() });
    const audit = await findAuditEntry(source, type, affectedId);
    const actorId = String(audit?.executor?.id ?? "");
    if (remember) rememberModeration(id, affectedId, { action: "server-ban-added", actorId, auditId: String(audit?.id ?? ""), at: now() });
    await record(id, action, actorId, affectedId, `actor=${labelUser(audit?.executor)}; tinta=${labelUser(source.user)}`, audit?.id);
  }

  async function handleGuildMemberRemove(member: { user?: EventUser } & GuildRef): Promise<void> {
    const id = guildId(member);
    const affectedId = targetId(member);
    if (!id || !affectedId) return;
    if (memberRemoveDelayMs > 0) await sleep(memberRemoveDelayMs);
    const recent = recentModeration(id, affectedId);
    if (recent?.action === "server-ban-added") return;
    const banAudit = await findAuditEntry(member, AuditLogEvent.MemberBanAdd, affectedId);
    if (banAudit) {
      const actorId = String(banAudit.executor?.id ?? "");
      rememberModeration(id, affectedId, { action: "server-ban-added", actorId, auditId: String(banAudit.id ?? ""), at: now() });
      await record(id, "server-ban-added", actorId, affectedId, `actor=${labelUser(banAudit.executor)}; tinta=${labelUser(member.user)}`, banAudit.id);
      return;
    }
    const kickAudit = await findAuditEntry(member, AuditLogEvent.MemberKick, affectedId);
    if (kickAudit) {
      const actorId = String(kickAudit.executor?.id ?? "");
      rememberModeration(id, affectedId, { action: "server-member-kicked", actorId, auditId: String(kickAudit.id ?? ""), at: now() });
      await record(id, "server-member-kicked", actorId, affectedId, `actor=${labelUser(kickAudit.executor)}; tinta=${labelUser(member.user)}`, kickAudit.id);
      return;
    }
    await record(id, "server-member-left", "", affectedId, `actor=necunoscut; tinta=${labelUser(member.user)}`);
  }

  async function handleGuildMemberTimeout(previous: TimeoutMemberRef, next: TimeoutMemberRef): Promise<void> {
    const id = guildId(next);
    const affectedId = String(next?.user?.id ?? next?.id ?? "");
    if (!id || !affectedId) return;
    const before = timeoutUntilMs(previous);
    const after = timeoutUntilMs(next);
    if (!(after > now()) || after <= before) return;
    const audit = await findAuditEntry(next, AuditLogEvent.MemberUpdate, affectedId);
    if (!audit) return;
    const actorId = String(audit.executor?.id ?? "");
    await record(id, "server-member-timeout", actorId, affectedId, `actor=${labelUser(audit.executor)}; tinta=${labelUser(next?.user)}; pana la ${new Date(after).toISOString()}`, audit.id);
  }

  return Object.freeze({
    handleGuildMemberTimeout,
    handleChannelCreate: (channel: NamedResource & GuildRef) =>
      recordResourceEvent(channel, AuditLogEvent.ChannelCreate, "server-channel-created", "channel"),
    handleChannelDelete: (channel: NamedResource & GuildRef) =>
      recordResourceEvent(channel, AuditLogEvent.ChannelDelete, "server-channel-deleted", "channel"),
    handleRoleCreate: (role: NamedResource & GuildRef) =>
      recordResourceEvent(role, AuditLogEvent.RoleCreate, "server-role-created", "role"),
    handleRoleDelete: (role: NamedResource & GuildRef) =>
      recordResourceEvent(role, AuditLogEvent.RoleDelete, "server-role-deleted", "role"),
    handleGuildMemberAdd: (member: { user?: EventUser } & GuildRef) =>
      record(guildId(member), "server-member-joined", "", targetId(member), `actor=necunoscut; tinta=${labelUser(member.user)}`),
    handleGuildBanAdd: (ban: { user?: EventUser } & GuildRef) =>
      recordModerationEvent(ban, AuditLogEvent.MemberBanAdd, "server-ban-added", true),
    handleGuildBanRemove: (ban: { user?: EventUser } & GuildRef) =>
      recordModerationEvent(ban, AuditLogEvent.MemberBanRemove, "server-ban-removed", false),
    handleGuildMemberRemove
  });
}

export default { createServerEventLogRuntime };
