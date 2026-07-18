"use strict";

import type { GuildSettings } from "../guild-config/guildSettingsTypes.js";
import { classifyJoinRisk, classifyConfirmedActivity } from "./threatInspection.js";
import { analyzeThreatBytes, analyzeThreatInput, type ExternalThreatScanner, type ThreatAnalysis } from "./threatPipeline.js";
import type { ThreatResource } from "./threatInspection.js";
import type { BotObservationAggregator } from "./botObservationAggregator.js";
import type { BotObservationEvent } from "./botObservationAggregator.js";
import type { BotObservationRepository } from "./botObservationRepository.js";
import { createAuditCorrelation } from "../admin-records/auditCorrelation.js";

type SecurityChannel = { id?: string; send?(payload: unknown): Promise<unknown> };
type SecurityClient = { channels?: { fetch(channelId: string): Promise<SecurityChannel | null> | SecurityChannel | null } };
type GuildMemberEvent = { guild?: { id?: string } | null; joinedTimestamp?: number; user?: { id?: string; tag?: string; bot?: boolean; createdTimestamp?: number } | null };
type MessageEvent = { guild?: { id?: string } | null; author?: { id?: string; tag?: string; bot?: boolean } | null; channel?: SecurityChannel | null; content?: string; delete?: () => Promise<unknown>; attachments?: Iterable<{ url?: string; name?: string }> };

export type SecurityRuntimeDeps = {
  getGuildSettings: (guildId: string) => Promise<GuildSettings | null>;
  client: SecurityClient;
  now?: () => number;
  newAccountAlertStore?: { hasSent(key: string): Promise<boolean>; markSent(key: string, expiresAt: number): Promise<void> };
  recordAudit?: (entry: { guildId: string; action: string; actorId?: string; details?: string; operationId?: string; requestId?: string }) => Promise<void>;
  analyzeThreat?: (input: { content?: string; attachments?: Array<{ kind: "attachment" | "url"; url: string; name?: string }>; urls?: Array<{ kind: "attachment" | "url"; url: string; name?: string }> }) => ThreatAnalysis;
  fetchThreatResource?: (resource: ThreatResource) => Promise<Uint8Array>;
  externalThreatScanner?: ExternalThreatScanner;
  observationAggregator?: BotObservationAggregator;
  observationRepository?: BotObservationRepository;
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
  const hydratedGuilds = new Set<string>();

  async function observe(event: BotObservationEvent): Promise<void> {
    if (deps.observationAggregator && !hydratedGuilds.has(event.guildId)) {
      const restored = await deps.observationRepository?.loadRecent(event.guildId, event.at - 15 * 60_000).catch(() => []);
      if (restored?.length) deps.observationAggregator.restore(restored);
      hydratedGuilds.add(event.guildId);
    }
    deps.observationAggregator?.record(event);
    await deps.observationRepository?.record(event).catch(() => undefined);
  }

  async function handleGuildMemberAdd(member: GuildMemberEvent): Promise<void> {
    const guildId = member.guild?.id;
    const user = member.user;
    if (!guildId || !user) return;
    const settings = await deps.getGuildSettings(guildId).catch(() => null);
    if (user.bot) {
      if (!settings?.botAddProtectionEnabled || !settings.botAddAlertChannelId) return;
      const channel = await Promise.resolve(deps.client.channels?.fetch(settings.botAddAlertChannelId)).catch(() => null);
      await observe({ id: `bot-add:${guildId}:${user.id ?? "unknown"}:${member.joinedTimestamp ?? now()}`, guildId, subjectId: user.id, kind: "bot-add", at: now() });
      await channel?.send?.({ content: `:shield: Bot adaugat pe server: ${user.tag ?? user.id ?? "necunoscut"}. Verifica aprobarea prin fluxul bot-add.`, allowedMentions: { parse: [] } }).catch(() => null);
      return;
    }
    if (!settings?.newAccountAlertsEnabled || !settings.newAccountAlertChannelId) return;
    const age = accountAgeDays(user.createdTimestamp, now());
    if (classifyJoinRisk({ accountAgeDays: age, isBot: user.bot }) === "normal") return;
    const key = `${guildId}:${user.id ?? "unknown"}:${member.joinedTimestamp ?? "unknown"}`;
    await observe({ id: `new-account:${key}`, guildId, subjectId: user.id, kind: "new-account", at: now() });
    if (deps.newAccountAlertStore?.hasSent && await deps.newAccountAlertStore.hasSent(key).catch(() => false)) return;
    const ageText = age === null ? "varsta necunoscuta" : `${age.toFixed(1)} zile`;
    const channel = await Promise.resolve(deps.client.channels?.fetch(settings.newAccountAlertChannelId)).catch(() => null);
    const joinedText = typeof member.joinedTimestamp === "number" ? new Date(member.joinedTimestamp).toISOString() : "necunoscuta";
    const createdText = typeof user.createdTimestamp === "number" ? new Date(user.createdTimestamp).toISOString() : "necunoscuta";
    await channel?.send?.({ content: `:shield: Cont nou detectat: <@${user.id ?? ""}> (${user.tag ?? user.id ?? "necunoscut"}), creat la ${createdText} (${ageText}); intrat la ${joinedText}.`, allowedMentions: { parse: [] } }).catch(() => null);
    if (deps.newAccountAlertStore?.markSent) await deps.newAccountAlertStore.markSent(key, now() + 30 * 86_400_000).catch(() => undefined);
    if (deps.recordAudit) {
      const correlation = createAuditCorrelation(guildId, key);
      await deps.recordAudit({ guildId, action: "new_account_alert", actorId: user.id, details: `created=${createdText}; joined=${joinedText}`, operationId: correlation.operationId, requestId: correlation.requestId }).catch(() => undefined);
    }
  }

  async function handleMessageCreate(message: MessageEvent): Promise<void> {
    const guildId = message.guild?.id;
    const author = message.author;
    const attachments = [...(message.attachments ?? [])].flatMap(attachment => attachment.url ? [{ kind: "attachment" as const, url: attachment.url, name: attachment.name }] : []);
    if (!guildId || !author || author.bot || (typeof message.content !== "string" && attachments.length === 0)) return;
    const settings = await deps.getGuildSettings(guildId).catch(() => null);
    if (!settings?.threatProtectionEnabled || !settings.threatAlertChannelId) return;
    const analysis = (deps.analyzeThreat ?? analyzeThreatInput)({
      content: message.content,
      attachments,
      urls: []
    });
    const analyses: ThreatAnalysis[] = [analysis];
    if (deps.fetchThreatResource) {
      for (const resource of attachments) {
        try {
          const bytes = await deps.fetchThreatResource(resource);
          analyses.push(await analyzeThreatBytes({ bytes, resource, externalScanner: deps.externalThreatScanner }));
        } catch {
          analyses.push({ state: "uncertain", complete: false, reason: "resursa nu a putut fi descarcata in siguranta", resources: [resource] });
        }
      }
    }
    const merged = mergeThreatAnalyses(analyses);
    if (merged.state === "clean") return;
    await observe({ id: `threat:${guildId}:${author.id ?? "unknown"}:${message.channel?.id ?? "unknown"}:${message.content ?? "attachment"}`, guildId, subjectId: author.id, kind: "threat", at: now(), details: `${merged.state}:${merged.reason}` });
    const confirmed = classifyConfirmedActivity({ suspiciousContent: suspiciousContent(message.content ?? "") || merged.state === "suspicious" || merged.state === "uncertain" || merged.state === "partial" || merged.state === "risky-file", confirmedThreat: merged.state === "confirmed" });
    const channel = await Promise.resolve(deps.client.channels?.fetch(settings.threatAlertChannelId)).catch(() => null);
    let deletion = "neefectuata";
    if (confirmed === "dangerous" && typeof message.delete === "function") {
      try { await message.delete(); deletion = "reusita"; } catch { deletion = "esuata"; }
    }
    await channel?.send?.({ content: `:warning: Continut ${confirmed} detectat de la <@${author.id ?? ""}> in <#${(message.channel as { id?: string } | null)?.id ?? ""}>. Stergere: ${deletion}.`, allowedMentions: { parse: [] } }).catch(() => null);
    if (deps.recordAudit) {
      const correlation = createAuditCorrelation(guildId, `threat:${author.id ?? "unknown"}:${message.channel?.id ?? "unknown"}`);
      await deps.recordAudit({ guildId, action: "threat_alert", actorId: author.id, details: `classification=${confirmed}; analysis=${merged.state}; deletion=${deletion}; reason=${merged.reason}`, operationId: correlation.operationId, requestId: correlation.requestId }).catch(() => undefined);
    }
  }

  return Object.freeze({ handleGuildMemberAdd, handleMessageCreate });
}

function mergeThreatAnalyses(analyses: readonly ThreatAnalysis[]): ThreatAnalysis {
  const resources = analyses.flatMap(analysis => analysis.resources);
  const confirmed = analyses.find(analysis => analysis.state === "confirmed");
  if (confirmed) return { ...confirmed, resources };
  const uncertain = analyses.find(analysis => analysis.state === "uncertain" || analysis.state === "unsupported" || analysis.state === "risky-file");
  if (uncertain) return { ...uncertain, resources };
  const suspicious = analyses.find(analysis => analysis.state === "suspicious");
  if (suspicious) return { ...suspicious, resources };
  const partial = analyses.find(analysis => analysis.state === "partial");
  if (partial) return { ...partial, resources };
  return { state: "clean", complete: true, reason: "nu au fost detectati indicatori pasivi", resources };
}

export default { createSecurityRuntime };
