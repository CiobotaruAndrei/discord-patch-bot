"use strict";

import { AuditLogEvent, UserFlags } from "discord.js";
import type { GuildSettings } from "../guild-config/guildSettingsTypes.js";
import botAddRepository from "../moderation/botAddRepository.js";
import { recordServerAuditEntry, type GuildAuditLogModelLike } from "../admin-records/auditLogRepository.js";
import { accountAgeLabel, isRecentAccount } from "./recentAccountPolicy.js";
import { assessBotRisk, type BotRiskRoleLike } from "./botRiskPolicy.js";
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
  roles?: { cache?: { size?: number } };
  fetchAuditLogs?(options: { type: AuditLogEvent; limit: number }): Promise<{ entries?: AuditCollection }>;
};
type MemberRoleCollection = { values(): IterableIterator<BotRiskRoleLike> };
type GuildMemberEvent = {
  guild?: SecurityGuild | null;
  joinedTimestamp?: number;
  user?: { id?: string; tag?: string; bot?: boolean; createdTimestamp?: number; flags?: { has(flag: number): boolean } | null } | null;
  roles?: { cache?: MemberRoleCollection };
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
  wait?: (ms: number) => Promise<void>;
};

const AUDIT_LOG_MATCH_WINDOW_MS = 60_000;
const AUDIT_LOG_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000];

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

async function botRequester(member: GuildMemberEvent, botId: string, eventTime: number): Promise<string | null> {
  const logs = await member.guild?.fetchAuditLogs?.({ type: AuditLogEvent.BotAdd, limit: 6 });
  const entries = logs?.entries ? [...logs.entries.values()] : [];
  const entry = entries.find(item =>
    item.target?.id === botId
    && typeof item.createdTimestamp === "number"
    && Math.abs(eventTime - item.createdTimestamp) <= AUDIT_LOG_MATCH_WINDOW_MS
  );
  return entry?.executor?.id ?? null;
}

async function botRequesterWithRetry(
  member: GuildMemberEvent,
  botId: string,
  eventTime: number,
  wait: (ms: number) => Promise<void>
): Promise<string | null> {
  let requesterId = await botRequester(member, botId, eventTime);
  for (const delayMs of AUDIT_LOG_RETRY_DELAYS_MS) {
    if (requesterId) return requesterId;
    await wait(delayMs);
    requesterId = await botRequester(member, botId, eventTime);
  }
  return requesterId;
}

function memberRoles(member: GuildMemberEvent): BotRiskRoleLike[] {
  return member.roles?.cache ? [...member.roles.cache.values()] : [];
}

function attachments(message: MessageEvent): DirectAttachment[] {
  return message.attachments ? [...message.attachments.values()] : [];
}

export function createSecurityRuntime(deps: SecurityRuntimeDeps) {
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const threatInspector = createThreatInspectionService({ httpReq: deps.httpReq });

  async function handleBotAdd(member: GuildMemberEvent, settings: GuildSettings, botId: string): Promise<void> {
    if (!settings.botAddProtectionEnabled || !settings.botAddAlertChannelId) return;
    const currentTime = now();
    const requesterId = await botRequesterWithRetry(member, botId, currentTime, wait);
    const ownerId = member.guild?.ownerId;
    const addedByOwner = Boolean(requesterId) && Boolean(ownerId) && requesterId === ownerId;
    const permission = !addedByOwner && requesterId
      ? await botAddRepository.consumeBotAddPermission(deps.GuildModel, String(member.guild?.id), botId, requesterId, new Date(currentTime))
      : null;
    const approved = addedByOwner || Boolean(permission);
    const channel = await alertChannel(deps, settings.botAddAlertChannelId);
    const owner = ownerMention(ownerId);
    const tag = member.user?.tag ?? botId;
    if (addedByOwner) {
      await channel.send({
        content: `${owner.prefix}:white_check_mark: Bot adaugat direct de ownerul serverului. Bot: ${tag} (${botId}). Ownerul nu are nevoie de aprobare one-time.`,
        allowedMentions: owner.allowedMentions
      });
      await recordServerAuditEntry(deps.GuildAuditLogModel, String(member.guild?.id), {
        userId: requesterId ?? "",
        action: "bot-add-owner-direct",
        details: `botId=${botId}; ownerId=${requesterId ?? "unknown"}; result=allowed`
      });
    } else if (!permission) {
      if (typeof member.kick !== "function") throw new Error(`Botul neaprobat ${botId} nu poate fi eliminat.`);
      await member.kick("Bot adaugat fara aprobare owner valida si neconsumata");
      deps.metrics && (deps.metrics.securityBotAddsBlocked = (deps.metrics.securityBotAddsBlocked ?? 0) + 1);
      await channel.send({
        content: `${owner.prefix}:shield: Bot neaprobat eliminat. Bot: ${tag} (${botId}). Solicitant audit: ${requesterId ? `<@${requesterId}>` : "nedetectat dupa reincercari"}.`,
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
    const risk = assessBotRisk({
      createdTimestamp: member.user?.createdTimestamp,
      verifiedBot: member.user?.flags?.has(UserFlags.VerifiedBot) === true,
      approved,
      roles: memberRoles(member),
      guildRoleCount: member.guild?.roles?.cache?.size ?? 0
    }, currentTime);
    const approvalLabel = addedByOwner ? "owner direct" : permission ? "valida si consumata" : "absenta";
    if (risk.level === "suspicious" || risk.level === "dangerous") {
      const classification = risk.level === "dangerous"
        ? `${owner.prefix}:rotating_light: Bot cu risc ridicat detectat (scor ${risk.score}). Bot: ${tag} (${botId}). Semnale: ${risk.signals.join("; ")}.`
        : `${owner.prefix}:warning: Bot suspect detectat (scor ${risk.score}). Bot: ${tag} (${botId}). Semnale: ${risk.signals.join("; ")}. Varsta cont: ${accountAgeLabel(member.user?.createdTimestamp, currentTime)}.`;
      await channel.send({ content: classification, allowedMentions: owner.allowedMentions });
      const action = risk.level === "dangerous"
        ? `${owner.prefix}:shield: Actiune recomandata pentru bot cu risc ridicat: ${approved ? "monitorizare owner necesara — verifica permisiunile si activitatea botului." : "botul a fost eliminat automat; verifica cine a incercat sa il adauge."} Aprobare: ${approvalLabel}.`
        : `${owner.prefix}:shield: Actiune recomandata pentru bot suspect: verifica manual permisiunile, rolurile si comportamentul botului si retrage accesul daca nu il recunosti. Aprobare: ${approvalLabel}.`;
      await channel.send({ content: action, allowedMentions: owner.allowedMentions });
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

  function threatSeverityLabel(verdict: "uncertain" | "policy-violation" | "risky-file" | "confirmed"): string {
    if (verdict === "confirmed") return "ridicata (amenintare confirmata)";
    if (verdict === "risky-file") return "ridicata ca tip de fisier, neconfirmata ca malware";
    if (verdict === "policy-violation") return "incalcare de politica a serverului, nu amenintare informatica";
    return "neconfirmata";
  }

  function verdictAllowsAutoDelete(verdict: "safe" | "uncertain" | "policy-violation" | "risky-file" | "confirmed", settings: GuildSettings): boolean {
    if (verdict === "confirmed") return true;
    if (verdict === "risky-file") return settings.threatAutoDeleteRiskyFiles === true;
    if (verdict === "policy-violation") return settings.threatAutoDeletePolicyViolations === true;
    return false;
  }

  function shouldAutoDelete(
    result: { verdict: "safe" | "uncertain" | "policy-violation" | "risky-file" | "confirmed"; detectedVerdicts?: Array<"safe" | "uncertain" | "policy-violation" | "risky-file" | "confirmed"> },
    settings: GuildSettings
  ): boolean {
    const verdicts = result.detectedVerdicts ?? [result.verdict];
    return verdicts.some(verdict => verdictAllowsAutoDelete(verdict, settings));
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
    if (shouldAutoDelete(result, settings)) {
      if (typeof message.delete !== "function") throw new Error("Mesajul marcat pentru stergere automata nu poate fi sters.");
      await message.delete();
      deps.metrics && (deps.metrics.securityThreatsDeleted = (deps.metrics.securityThreatsDeleted ?? 0) + 1);
      action = result.verdict === "confirmed"
        ? "mesaj sters (amenintare confirmata); autorul nu a fost sanctionat automat"
        : "mesaj sters conform politicii explicite a serverului; autorul nu a fost sanctionat automat";
    }
    const channel = await alertChannel(deps, settings.threatAlertChannelId);
    await channel.send({
      content: [
        `:warning: Alerta securitate ${result.verdict}.`,
        `Severitate: ${threatSeverityLabel(result.verdict)}.`,
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
