"use strict";

import type { SecurityMetricRecorder } from "../../shared/metricRecorderPorts.js";
import { AuditLogEvent, UserFlags } from "discord.js";
import type { GuildSettings } from "../guild-config/guildSettingsTypes.js";
import botAddRepository from "../moderation/botAddRepository.js";
import { recordServerAuditEntry, type GuildAuditLogModelLike } from "../admin-records/auditLogRepository.js";
import { accountAgeLabel, isRecentAccount } from "./recentAccountPolicy.js";
import { assessBotRisk, type BotRiskRoleLike } from "./botRiskPolicy.js";
import { createThreatInspectionService } from "./threatInspectionService.js";
import type { DirectAttachment } from "../moderation/moderationInputPolicy.js";
import {
  recordBotObservationEvent,
  startBotObservation,
  type BotObservationModelLike
} from "./botObservationRepository.js";
import { deliverNewAccountAlert, type NewAccountAlertClaim } from "./newAccountAlertDedup.js";

export type SecurityChannel = { id?: string; send?(payload: unknown): Promise<unknown> };
export type SendableSecurityChannel = SecurityChannel & { send(payload: unknown): Promise<unknown> };
export type SecurityClient = { channels?: { fetch(channelId: string): Promise<SecurityChannel | null> | SecurityChannel | null } };
export type AuditEntry = {
  target?: { id?: string } | null;
  executor?: { id?: string } | null;
  createdTimestamp?: number;
};
export type AuditCollection = { values(): IterableIterator<AuditEntry> };
export type SecurityGuild = {
  id?: string;
  ownerId?: string;
  roles?: { cache?: { size?: number } };
  fetchAuditLogs?(options: { type: AuditLogEvent; limit: number }): Promise<{ entries?: AuditCollection }>;
};
type MemberRoleCollection = { values(): IterableIterator<BotRiskRoleLike> };
export type GuildMemberEvent = {
  guild?: SecurityGuild | null;
  joinedTimestamp?: number;
  user?: { id?: string; tag?: string; bot?: boolean; createdTimestamp?: number; flags?: { has(flag: number): boolean } | null } | null;
  roles?: { cache?: MemberRoleCollection };
  kick?(reason?: string): Promise<unknown>;
};
type AttachmentCollection = { values(): IterableIterator<DirectAttachment> };
export type MessageEvent = {
  id?: string;
  guild?: { id?: string; ownerId?: string } | null;
  author?: { id?: string; tag?: string; bot?: boolean } | null;
  channel?: SecurityChannel | null;
  content?: string;
  attachments?: AttachmentCollection;
  createdTimestamp?: number;
  delete?(): Promise<unknown>;
};
type GuildModel = Parameters<typeof botAddRepository.getBotAddState>[0] & BotObservationModelLike;
export type SecurityRuntimeDeps = {
  getGuildSettings: (guildId: string) => Promise<GuildSettings | null>;
  client: SecurityClient;
  GuildModel: GuildModel;
  GuildAuditLogModel: GuildAuditLogModelLike;
  httpReq?: Parameters<typeof createThreatInspectionService>[0]["httpReq"];
  reputationScan?: Parameters<typeof createThreatInspectionService>[0]["reputationScan"];
  claimNewAccountAlert?: (guildId: string, userId: string) => Promise<NewAccountAlertClaim | null>;
  logger?: (level: string, context: string, message: string, meta?: unknown) => void;
  metrics?: SecurityMetricRecorder;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
};

export const AUDIT_LOG_MATCH_WINDOW_MS = 60_000;
export const AUDIT_LOG_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000];

export function ownerMention(ownerId: string | undefined): { prefix: string; allowedMentions: unknown } {
  return ownerId
    ? { prefix: `<@${ownerId}> `, allowedMentions: { parse: [], users: [ownerId] } }
    : { prefix: "", allowedMentions: { parse: [] } };
}

export async function alertChannel(deps: SecurityRuntimeDeps, channelId: string): Promise<SendableSecurityChannel> {
  const channel = await Promise.resolve(deps.client.channels?.fetch(channelId));
  const send = channel?.send;
  if (!channel || !send) throw new Error(`Canalul de securitate ${channelId} nu este disponibil.`);
  return { ...channel, send: payload => send.call(channel, payload) };
}

export async function botRequester(member: GuildMemberEvent, botId: string, eventTime: number): Promise<string | null> {
  const logs = await member.guild?.fetchAuditLogs?.({ type: AuditLogEvent.BotAdd, limit: 6 });
  const entries = logs?.entries ? [...logs.entries.values()] : [];
  const entry = entries.find(item =>
    item.target?.id === botId
    && typeof item.createdTimestamp === "number"
    && Math.abs(eventTime - item.createdTimestamp) <= AUDIT_LOG_MATCH_WINDOW_MS
  );
  return entry?.executor?.id ?? null;
}

export async function botRequesterWithRetry(
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

export function memberRoles(member: GuildMemberEvent): BotRiskRoleLike[] {
  return member.roles?.cache ? [...member.roles.cache.values()] : [];
}

export function attachments(message: MessageEvent): DirectAttachment[] {
  return message.attachments ? [...message.attachments.values()] : [];
}

export async function deleteThreatMessage(message: MessageEvent, metrics: SecurityMetricRecorder | undefined): Promise<string> {
  if (typeof message.delete !== "function") {
    metrics?.threatDeleteFailed();
    return "mesaj nesters: lipseste permisiunea sau operatia de stergere";
  }
  try {
    await message.delete();
    metrics?.threatDeleted();
    return "mesaj sters";
  } catch (error: unknown) {
    metrics?.threatDeleteFailed();
    const reason = error instanceof Error ? error.message : "eroare Discord necunoscuta";
    return `mesaj nesters: ${reason}`;
  }
}
