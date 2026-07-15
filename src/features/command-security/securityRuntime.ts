"use strict";

import type { GuildSettings } from "../guild-config/guildSettingsTypes.js";

type SecurityChannel = { id?: string; send?(payload: unknown): Promise<unknown> };
type SecurityClient = { channels?: { fetch(channelId: string): Promise<SecurityChannel | null> | SecurityChannel | null } };
type GuildMemberEvent = { guild?: { id?: string } | null; joinedTimestamp?: number; user?: { id?: string; tag?: string; bot?: boolean; createdTimestamp?: number } | null };
type MessageEvent = { guild?: { id?: string } | null; author?: { id?: string; tag?: string; bot?: boolean } | null; channel?: SecurityChannel | null; content?: string };

export type SecurityRuntimeDeps = {
  getGuildSettings: (guildId: string) => Promise<GuildSettings | null>;
  client: SecurityClient;
  now?: () => number;
};

function accountAgeDays(createdTimestamp: number | undefined, now: number): number | null {
  if (typeof createdTimestamp !== "number" || !Number.isFinite(createdTimestamp)) return null;
  return Math.max(0, (now - createdTimestamp) / 86_400_000);
}

function suspiciousContent(content: string): boolean {
  return /(?:discord(?:app)?\.com\/invite\/|discord\.gg\/|@everyone|@here)/i.test(content);
}

export function createSecurityRuntime(deps: SecurityRuntimeDeps) {
  const now = deps.now ?? Date.now;

  async function handleGuildMemberAdd(member: GuildMemberEvent): Promise<void> {
    const guildId = member.guild?.id;
    const user = member.user;
    if (!guildId || !user) return;
    const settings = await deps.getGuildSettings(guildId).catch(() => null);
    if (user.bot) {
      if (!settings?.botAddProtectionEnabled || !settings.botAddAlertChannelId) return;
      const channel = await Promise.resolve(deps.client.channels?.fetch(settings.botAddAlertChannelId)).catch(() => null);
      await channel?.send?.({ content: `:shield: Bot adaugat pe server: ${user.tag ?? user.id ?? "necunoscut"}. Verifica aprobarea prin fluxul bot-add.`, allowedMentions: { parse: [] } }).catch(() => null);
      return;
    }
    if (!settings?.newAccountAlertsEnabled || !settings.newAccountAlertChannelId) return;
    const age = accountAgeDays(user.createdTimestamp, now());
    if (age !== null && age > 90) return;
    const ageText = age === null ? "varsta necunoscuta" : `${age.toFixed(1)} zile`;
    const channel = await Promise.resolve(deps.client.channels?.fetch(settings.newAccountAlertChannelId)).catch(() => null);
    const joinedText = typeof member.joinedTimestamp === "number" ? new Date(member.joinedTimestamp).toISOString() : "necunoscuta";
    await channel?.send?.({ content: `:shield: Cont nou detectat: <@${user.id ?? ""}> (${user.tag ?? user.id ?? "necunoscut"}), creat acum ${ageText}; intrat la ${joinedText}.`, allowedMentions: { parse: [] } }).catch(() => null);
  }

  async function handleMessageCreate(message: MessageEvent): Promise<void> {
    const guildId = message.guild?.id;
    const author = message.author;
    if (!guildId || !author || author.bot || typeof message.content !== "string" || !suspiciousContent(message.content)) return;
    const settings = await deps.getGuildSettings(guildId).catch(() => null);
    if (!settings?.threatProtectionEnabled || !settings.threatAlertChannelId) return;
    const channel = await Promise.resolve(deps.client.channels?.fetch(settings.threatAlertChannelId)).catch(() => null);
    await channel?.send?.({ content: `:warning: Continut posibil periculos detectat de la <@${author.id ?? ""}> in <#${(message.channel as { id?: string } | null)?.id ?? ""}>.`, allowedMentions: { parse: [] } }).catch(() => null);
  }

  return Object.freeze({ handleGuildMemberAdd, handleMessageCreate });
}

export default { createSecurityRuntime };
