"use strict";

import { AuditLogEvent } from "discord.js";
import type { GuildSettings } from "../guild-config/guildSettingsTypes.js";
import botAddRepository from "../moderation/botAddRepository.js";
import { recordServerAuditEntry, type GuildAuditLogModelLike } from "../admin-records/auditLogRepository.js";
import { accountAgeLabel, isRecentAccount } from "./recentAccountPolicy.js";
import { createThreatInspectionService } from "./threatInspectionService.js";
import type { DirectAttachment } from "../moderation/moderationInputPolicy.js";

type SecurityChannel = { id?: string; send?(payload: unknown): Promise<unknown> };
type SendableSecurityChannel = SecurityChannel & { send(payload: unknown): Promise<unknown> };
type SecurityClient = { channels?: { fetch(channelId: string): Promise<SecurityChannel | null> | SecurityChannel | null } };
type AuditEntry = {
  target?: { id?: string } | null;
  executor?: { id?: string } | null;
  createdTimestamp?: number;
};
type AuditCollection = { values(): IterableIterator<AuditEntry> };
type SecurityGuild = {
  id?: string;
  ownerId?: string;
  fetchAuditLogs?(options: { type: AuditLogEvent; limit: number }): Promise<{ entries?: AuditCollection }>;
};
type GuildMemberEvent = {
  guild?: SecurityGuild | null;
  joinedTimestamp?: number;
  user?: { id?: string; tag?: string; bot?: boolean; createdTimestamp?: number } | null;
  kick?(reason?: string): Promise<unknown>;
};
type AttachmentCollection = { values(): IterableIterator<DirectAttachment> };
type MessageEvent = {
  guild?: { id?: string } | null;
  author?: { id?: string; tag?: string; bot?: boolean } | null;
  channel?: SecurityChannel | null;
  content?: string;
  attachments?: AttachmentCollection;
  createdTimestamp?: number;
  delete?(): Promise<unknown>;
};
type GuildModel = Parameters<typeof botAddRepository.getBotAddState>[0] & {
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
};
type RuntimeMetrics = {
  securityThreatsDeleted?: number;
  securityBotAddsBlocked?: number;
};

export type SecurityRuntimeDeps = {
  getGuildSettings: (guildId: string) => Promise<GuildSettings | null>;
  client: SecurityClient;
  GuildModel: GuildModel;
  GuildAuditLogModel: GuildAuditLogModelLike;
  httpReq?: Parameters<typeof createThreatInspectionService>[0]["httpReq"];
  metrics?: RuntimeMetrics;
  now?: () => number;
};

function ownerMention(ownerId: string | undefined): { prefix: string; allowedMentions: unknown } {
  return ownerId
    ? { prefix: `<@${ownerId}> `, allowedMentions: { parse: [], users: [ownerId] } }
    : { prefix: "", allowedMentions: { parse: [] } };
}

async function alertChannel(deps: SecurityRuntimeDeps, channelId: string): Promise<SendableSecurityChannel> {
  const channel = await Promise.resolve(deps.client.channels?.fetch(channelId));
  const send = channel?.send;
  if (!channel || !send) throw new Error(`Canalul de securitate ${channelId} nu este disponibil.`);
  return { ...channel, send: payload => send.call(channel, payload) };
}

async function botRequester(member: GuildMemberEvent, botId: string, now: number): Promise<string | null> {
  const logs = await member.guild?.fetchAuditLogs?.({ type: AuditLogEvent.BotAdd, limit: 6 });
  const entries = logs?.entries ? [...logs.entries.values()] : [];
  const entry = entries.find(item =>
    item.target?.id === botId
    && typeof item.createdTimestamp === "number"
    && Math.abs(now - item.createdTimestamp) <= 20_000
  );
  return entry?.executor?.id ?? null;
}

function botRisk(createdTimestamp: number | undefined, now: number): "normal" | "suspicious" | "dangerous" {
  if (typeof createdTimestamp !== "number" || !Number.isFinite(createdTimestamp)) return "suspicious";
  const age = now - createdTimestamp;
  if (age < 86_400_000) return "dangerous";
  if (age < 30 * 86_400_000) return "suspicious";
  return "normal";
}

function attachments(message: MessageEvent): DirectAttachment[] {
  return message.attachments ? [...message.attachments.values()] : [];
}

export function createSecurityRuntime(deps: SecurityRuntimeDeps) {
  const now = deps.now ?? Date.now;
  const threatInspector = createThreatInspectionService({ httpReq: deps.httpReq });

  async function handleBotAdd(member: GuildMemberEvent, settings: GuildSettings, botId: string): Promise<void> {
    if (!settings.botAddProtectionEnabled || !settings.botAddAlertChannelId) return;
    const currentTime = now();
    const requesterId = await botRequester(member, botId, currentTime);
    const permission = requesterId
      ? await botAddRepository.consumeBotAddPermission(deps.GuildModel, String(member.guild?.id), botId, requesterId, new Date(currentTime))
      : null;
    const channel = await alertChannel(deps, settings.botAddAlertChannelId);
    const owner = ownerMention(member.guild?.ownerId);
    const tag = member.user?.tag ?? botId;
    if (!permission) {
      if (typeof member.kick !== "function") throw new Error(`Botul neaprobat ${botId} nu poate fi eliminat.`);
      await member.kick("Bot adaugat fara aprobare owner valida si neconsumata");
      deps.metrics && (deps.metrics.securityBotAddsBlocked = (deps.metrics.securityBotAddsBlocked ?? 0) + 1);
      await channel.send({
        content: `${owner.prefix}:shield: Bot neaprobat eliminat. Bot: ${tag} (${botId}). Solicitant audit: ${requesterId ? `<@${requesterId}>` : "nedetectat"}.`,
        allowedMentions: owner.allowedMentions
      });
      await recordServerAuditEntry(deps.GuildAuditLogModel, String(member.guild?.id), {
        userId: requesterId ?? "",
        action: "bot-add-blocked",
        details: `botId=${botId}; requesterId=${requesterId ?? "unknown"}; result=kicked`
      });
    } else {
      await channel.send({
        content: `${owner.prefix}:white_check_mark: Bot aprobat adaugat. Bot: ${tag} (${botId}). Solicitant audit: <@${requesterId}>. Aprobarea one-time a fost consumata.`,
        allowedMentions: owner.allowedMentions
      });
      await recordServerAuditEntry(deps.GuildAuditLogModel, String(member.guild?.id), {
        userId: requesterId ?? "",
        action: "bot-add-approved-used",
        details: `botId=${botId}; requesterId=${requesterId}; requestId=${permission.requestId}`
      });
    }
    const risk = botRisk(member.user?.createdTimestamp, currentTime);
    if (risk === "suspicious" || risk === "dangerous") {
      await channel.send({
        content: `${owner.prefix}:warning: Bot suspect detectat. Bot: ${tag} (${botId}). Varsta cont: ${accountAgeLabel(member.user?.createdTimestamp, currentTime)}. Aprobare: ${permission ? "valida si consumata" : "absenta"}.`,
        allowedMentions: owner.allowedMentions
      });
    }
    if (risk === "dangerous") {
      await channel.send({
        content: `${owner.prefix}:rotating_light: Bot cu risc ridicat detectat: cont creat in ultimele 24 de ore. Bot: ${tag} (${botId}). Actiune: ${permission ? "monitorizare owner necesara" : "eliminat automat"}.`,
        allowedMentions: owner.allowedMentions
      });
    }
  }

  async function handleGuildMemberAdd(member: GuildMemberEvent): Promise<void> {
    const guildId = member.guild?.id;
    const user = member.user;
    if (!guildId || !user?.id) return;
    const settings = await deps.getGuildSettings(guildId);
    if (!settings) return;
    if (user.bot) return handleBotAdd(member, settings, user.id);
    if (!settings.newAccountAlertsEnabled || !settings.newAccountAlertChannelId || !isRecentAccount(user.createdTimestamp, new Date(now()))) return;
    const channel = await alertChannel(deps, settings.newAccountAlertChannelId);
    const joinedText = typeof member.joinedTimestamp === "number" ? new Date(member.joinedTimestamp).toISOString() : "necunoscuta";
    await channel.send({
      content: `:shield: Cont nou detectat: <@${user.id}> (${user.tag ?? user.id}), creat acum ${accountAgeLabel(user.createdTimestamp, now())}; intrat la ${joinedText}.`,
      allowedMentions: { parse: [] }
    });
  }

  async function handleMessageCreate(message: MessageEvent): Promise<void> {
    const guildId = message.guild?.id;
    const author = message.author;
    if (!guildId || !author?.id || author.bot) return;
    const settings = await deps.getGuildSettings(guildId);
    if (!settings?.threatProtectionEnabled || !settings.threatAlertChannelId) return;
    const result = await threatInspector.inspectMessage(message.content ?? "", attachments(message));
    if (result.verdict === "safe") return;
    let action = "mesaj pastrat; verificare manuala necesara";
    if (result.verdict === "confirmed") {
      if (typeof message.delete !== "function") throw new Error("Mesajul periculos confirmat nu poate fi sters.");
      await message.delete();
      deps.metrics && (deps.metrics.securityThreatsDeleted = (deps.metrics.securityThreatsDeleted ?? 0) + 1);
      action = "mesaj sters; autorul nu a fost sanctionat automat";
    }
    const channel = await alertChannel(deps, settings.threatAlertChannelId);
    await channel.send({
      content: [
        `:warning: Alerta securitate ${result.verdict}.`,
        `Severitate: ${result.verdict === "confirmed" ? "ridicata" : "neconfirmata"}.`,
        `Motiv: ${result.reason}.`,
        `Utilizator: <@${author.id}>.`,
        `Canal: <#${message.channel?.id ?? ""}>.`,
        `Rezultat: ${action}.`,
        `Moment: ${new Date(message.createdTimestamp ?? now()).toISOString()}.`
      ].join("\n"),
      allowedMentions: { parse: [] }
    });
  }

  async function handleChannelDelete(channel: SecurityChannel & { guild?: { id?: string } | null }): Promise<void> {
    const guildId = channel.guild?.id;
    if (!guildId || !channel.id) return;
    await deps.GuildModel.updateOne(
      { _id: guildId },
      {
        $pull: {
          lockedChannelIds: channel.id,
          lockedChannelPermissions: { channelId: channel.id }
        }
      }
    );
  }

  return Object.freeze({ handleGuildMemberAdd, handleMessageCreate, handleChannelDelete });
}

export default { createSecurityRuntime };
