"use strict";

import { PermissionFlagsBits } from "discord.js";

import type { ModerationTarget } from "./moderationSanctionUseCase.js";

export type ModerationUser = { id: string; username?: string; bot?: boolean };
export type ModerationRole = { position?: number };
export type ModerationMember = {
  id: string;
  user?: ModerationUser;
  roles?: { highest?: ModerationRole };
  timeout?: (duration: number | null, reason?: string) => Promise<unknown>;
  kick?: (reason?: string) => Promise<unknown>;
  ban?: (options?: { reason?: string }) => Promise<unknown>;
  permissions?: { has(permission: string | bigint): boolean };
};
export type ModerationChannel = {
  id?: string;
  send?: (payload: unknown) => Promise<unknown>;
  isTextBased?: () => boolean;
  permissionsFor?: (member: ModerationMember) => { has(permission: bigint): boolean } | null;
};
export type ModerationGuild = {
  id: string;
  ownerId?: string;
  members: { me?: ModerationMember; fetch(userId: string): Promise<ModerationMember> };
  bans?: { remove(userId: string, reason?: string): Promise<unknown> };
  channels?: { fetch(channelId: string): Promise<ModerationChannel | null> };
};
export type ModerationActor = { actorId: string | undefined; actorMember: ModerationMember | null | undefined };

export function parseDuration(value: string): number | null {
  const match = /^([1-9][0-9]{0,5})(s|m|h|d|w)$/i.exec(value.trim());
  if (!match) return null;
  const units: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  const result = Number(match[1]) * units[match[2].toLowerCase()];
  return result > 0 && result <= 28 * 86_400_000 ? result : null;
}

function highestRole(member: ModerationMember | null | undefined): number {
  return member?.roles?.highest?.position ?? 0;
}

export function canActOn(guild: ModerationGuild, actor: ModerationActor, target: ModerationMember | null): boolean {
  if (!target || !actor.actorId) return false;
  if (target.id === actor.actorId || target.user?.bot || target.id === guild.ownerId) return false;
  if (actor.actorMember && actor.actorId !== guild.ownerId && highestRole(actor.actorMember) <= highestRole(target)) return false;
  const me = guild.members.me;
  if (me && highestRole(me) <= highestRole(target)) return false;
  return true;
}

export function botHasPermission(guild: ModerationGuild, permission: string): boolean {
  return guild.members.me?.permissions?.has(permission) ?? false;
}

export function missingWarningChannelPermissions(channel: ModerationChannel, bot: ModerationMember | undefined): string[] {
  if (!channel.id || !bot || channel.isTextBased?.() === false || typeof channel.send !== "function") return ["canal text valid"];
  const permissions = channel.permissionsFor?.(bot);
  if (!permissions) return ["permisiuni verificabile"];
  const required: Array<[bigint, string]> = [
    [PermissionFlagsBits.ViewChannel, "View Channel"],
    [PermissionFlagsBits.SendMessages, "Send Messages"],
    [PermissionFlagsBits.EmbedLinks, "Embed Links"]
  ];
  return required.filter(([permission]) => permissions.has(permission) !== true).map(([, label]) => label);
}

export function memberAsTarget(guild: ModerationGuild, actor: ModerationActor, member: ModerationMember): ModerationTarget {
  return {
    canAct: canActOn(guild, actor, member),
    canTimeout: typeof member.timeout === "function",
    canKick: typeof member.kick === "function",
    canBan: typeof member.ban === "function",
    timeout: (duration, reason) => member.timeout?.(duration, reason) ?? Promise.resolve(undefined),
    kick: reason => member.kick?.(reason) ?? Promise.resolve(undefined),
    ban: reason => member.ban?.({ reason }) ?? Promise.resolve(undefined)
  };
}

export function resolveTargetPort(
  guild: ModerationGuild,
  actor: ModerationActor,
  userId: string
): () => Promise<ModerationTarget | null> {
  return async () => {
    const member = await guild.members.fetch(userId).catch(() => null);
    return member ? memberAsTarget(guild, actor, member) : null;
  };
}

export function unbanPort(guild: ModerationGuild, userId: string): ((reason: string | undefined) => Promise<unknown>) | null {
  const bans = guild.bans;
  if (!bans?.remove) return null;
  return reason => bans.remove(userId, reason);
}
