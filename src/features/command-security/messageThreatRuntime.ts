"use strict";

import type { GuildSettings } from "../guild-config/guildSettingsTypes.js";
import { recordServerAuditEntry } from "../admin-records/auditLogRepository.js";
import { createThreatInspectionService } from "./threatInspectionService.js";
import type { SecurityRuntimeDeps, GuildMemberEvent, MessageEvent, SecurityChannel } from "./securityEventContext.js";
import { alertChannel, attachments, deleteThreatMessage, ownerMention } from "./securityEventContext.js";

export interface MessageThreatRuntimeDeps extends SecurityRuntimeDeps {
  observeBotMessage(
    guildId: string,
    botId: string,
    message: MessageEvent,
    verdict: "safe" | "uncertain" | "policy-violation" | "risky-file" | "confirmed"
  ): Promise<{ duplicate: boolean; burstStarted: boolean; recentCount: number }>;
}

export function createMessageThreatRuntime(deps: MessageThreatRuntimeDeps) {
  const now = deps.now ?? Date.now;
  const threatInspector = createThreatInspectionService({ httpReq: deps.httpReq, reputationScan: deps.reputationScan });
  const observeBotMessage = deps.observeBotMessage;

  function threatSeverityLabel(verdict: "uncertain" | "policy-violation" | "risky-file" | "confirmed"): string {
    if (verdict === "confirmed") return "ridicata (amenintare confirmata)";
    if (verdict === "risky-file") return "ridicata ca tip de fisier, neconfirmata ca malware";
    if (verdict === "policy-violation") return "incalcare de politica a serverului, nu amenintare informatica";
    return "neconfirmata";
  }

  function shouldAutoDelete(
    result: { verdict: "safe" | "uncertain" | "policy-violation" | "risky-file" | "confirmed"; detectedVerdicts?: Array<"safe" | "uncertain" | "policy-violation" | "risky-file" | "confirmed"> }
  ): boolean {
    const verdicts = result.detectedVerdicts ?? [result.verdict];
    return verdicts.includes("confirmed");
  }

  async function handleBotMessageCreate(message: MessageEvent, guildId: string, authorId: string, settings: GuildSettings): Promise<void> {
    const channelId = settings.threatProtectionEnabled && settings.threatAlertChannelId
      ? settings.threatAlertChannelId
      : settings.botAddProtectionEnabled && settings.botAddAlertChannelId
        ? settings.botAddAlertChannelId
        : null;
    if (!channelId) return;
    const result = await threatInspector.inspectMessage(message.content ?? "", attachments(message));
    const observation = await observeBotMessage(guildId, authorId, message, result.verdict);
    if (result.verdict === "safe") return;
    if (observation.duplicate) return;
    const channel = await alertChannel(deps, channelId);
    const owner = ownerMention(message.guild?.ownerId);
    if (result.verdict === "confirmed") {
      const deletedNote = await deleteThreatMessage(message, deps.metrics);
      await channel.send({
        content: `${owner.prefix}:rotating_light: INCIDENT CRITIC: botul <@${authorId}> a postat continut confirmat periculos. Motiv: ${result.reason}. Rezultat: ${deletedNote}. Interventie urgenta: verifica si elimina manual botul daca e necesar.`,
        allowedMentions: owner.allowedMentions
      });
      await recordServerAuditEntry(deps.GuildAuditLogModel, guildId, {
        userId: authorId,
        action: "bot-confirmed-dangerous-activity",
        details: `botId=${authorId}; verdict=confirmed; channelId=${message.channel?.id ?? ""}`
      });
      return;
    }
    await channel.send({
      content: `${owner.prefix}:warning: Bot monitorizat: <@${authorId}> a postat continut clasificat ${result.verdict} (neconfirmat ca amenintare). Motiv: ${result.reason}. Botul aprobat NU e eliminat automat pentru suspiciune; verificare manuala recomandata.`,
      allowedMentions: owner.allowedMentions
    });
    if (observation.burstStarted) {
      await channel.send({
        content: `${owner.prefix}:warning: Activitate agregata: botul <@${authorId}> a produs ${observation.recentCount} evenimente monitorizate intr-un minut. Incidentul este grupat pentru verificare, fara eliminare automata.`,
        allowedMentions: owner.allowedMentions
      });
    }
  }

  async function handleMessageCreate(message: MessageEvent): Promise<void> {
    const guildId = message.guild?.id;
    const author = message.author;
    if (!guildId || !author?.id) return;
    const settings = await deps.getGuildSettings(guildId);
    if (!settings) return;
    if (author.bot) return handleBotMessageCreate(message, guildId, author.id, settings);
    if (!settings.threatProtectionEnabled || !settings.threatAlertChannelId) return;
    const result = await threatInspector.inspectMessage(message.content ?? "", attachments(message));
    if (result.verdict === "safe") return;
    const channel = await alertChannel(deps, settings.threatAlertChannelId);
    let action = "mesaj pastrat; verificare manuala necesara (doar amenintarile confirmate se sterg automat)";
    if (shouldAutoDelete(result)) {
      const deletion = await deleteThreatMessage(message, deps.metrics);
      action = `${deletion} (amenintare confirmata); autorul nu a fost sanctionat automat`;
    }
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
    await recordServerAuditEntry(deps.GuildAuditLogModel, guildId, {
      userId: author.id,
      action: result.verdict === "confirmed" ? "confirmed-threat-message" : "security-message-reviewed",
      details: `verdict=${result.verdict}; channelId=${message.channel?.id ?? ""}; result=${action}`
    });
  }

  return { handleMessageCreate };
}
