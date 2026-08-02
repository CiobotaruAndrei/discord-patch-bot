"use strict";

import type { GuildSettings } from "../guild-config/guildSettingsTypes.js";
import { createPermissionRequestRepository } from "./permissionRequestRepository.js";
import { recordServerAuditEntry } from "../admin-records/auditLogRepository.js";
import { accountAgeLabel, isRecentAccount } from "./recentAccountPolicy.js";
import { assessBotRisk } from "./botRiskPolicy.js";
import { recordBotObservationEvent, startBotObservation } from "./botObservationRepository.js";
import { deliverNewAccountAlert } from "./newAccountAlertDedup.js";
import { UserFlags } from "discord.js";
import type { SecurityRuntimeDeps, GuildMemberEvent, MessageEvent, SecurityChannel } from "./securityEventContext.js";
import { alertChannel, attachments, botRequesterWithRetry, memberRoles, ownerMention } from "./securityEventContext.js";

export function createBotAddSecurityRuntime(deps: SecurityRuntimeDeps) {
  const now = deps.now ?? Date.now;
  const approvals = deps.PermissionRequestModel
    ? createPermissionRequestRepository(deps.PermissionRequestModel)
    : null;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));

  async function beginBotObservation(
    member: GuildMemberEvent,
    botId: string,
    requesterId: string | null,
    approval: "owner" | "one-time" | "unapproved-removal-failed",
    initialRisk: "normal" | "suspicious" | "dangerous",
    currentTime: number
  ): Promise<void> {
    const guildId = member.guild?.id;
    if (!guildId) return;
    await startBotObservation(deps.GuildModel, guildId, {
      botId,
      requesterId: requesterId ?? "",
      approval,
      initialRisk,
      joinedAt: new Date(member.joinedTimestamp ?? currentTime)
    });
  }

  async function observeBotMessage(
    guildId: string,
    botId: string,
    message: MessageEvent,
    verdict: "safe" | "uncertain" | "policy-violation" | "risky-file" | "confirmed"
  ) {
    const at = new Date(message.createdTimestamp ?? now());
    const key = `message:${message.id ?? `${message.channel?.id ?? ""}:${at.getTime()}`}:${verdict}`;
    return recordBotObservationEvent(deps.GuildModel, guildId, botId, {
      key,
      kind: `message-${verdict}`,
      at,
      confirmed: verdict === "confirmed"
    });
  }

  async function handleBotAdd(member: GuildMemberEvent, settings: GuildSettings, botId: string): Promise<void> {
    if (!settings.moderationGuardEnabled || !settings.permissionRequestChannelId || !approvals) return;
    const guildId = String(member.guild?.id ?? "");
    if (deps.isRaidConfirmed && await deps.isRaidConfirmed(guildId).catch(() => false)) return;

    const currentTime = now();
    const requesterId = await botRequesterWithRetry(member, botId, currentTime, wait);
    const ownerId = member.guild?.ownerId;
    const addedByOwner = Boolean(requesterId) && Boolean(ownerId) && requesterId === ownerId;
    const permission = !addedByOwner && requesterId
      ? await approvals
        .consume(guildId, "bot-add", requesterId, { target: botId, action: "add", botId }, new Date(currentTime))
        .catch(() => null)
      : null;
    const approved = addedByOwner || Boolean(permission);
    const channel = await alertChannel(deps, settings.permissionRequestChannelId);
    const owner = ownerMention(ownerId);
    const tag = member.user?.tag ?? botId;
    const risk = assessBotRisk({
      createdTimestamp: member.user?.createdTimestamp,
      verifiedBot: member.user?.flags?.has(UserFlags.VerifiedBot) === true,
      approved,
      roles: memberRoles(member),
      guildRoleCount: member.guild?.roles?.cache?.size ?? 0
    }, currentTime);
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
      const kick = member.kick;
      let removed = typeof kick === "function";
      if (typeof kick === "function") {
        try {
          await kick.call(member, "Bot adaugat fara aprobare owner valida si neconsumata");
        } catch {
          removed = false;
        }
      }
      if (!removed) {
        await beginBotObservation(member, botId, requesterId, "unapproved-removal-failed", risk.level, currentTime);
        await channel.send({
          content: `${owner.prefix}:rotating_light: INCIDENT CRITIC: botul neaprobat ${tag} (${botId}) NU a putut fi eliminat (rolul botului de securitate e sub rolul botului adaugat sau lipseste Kick Members). Muta botul de securitate mai sus in ierarhie sau elimina manual botul. Solicitant audit: ${requesterId ? `<@${requesterId}>` : "nedetectat dupa reincercari"}.`,
          allowedMentions: owner.allowedMentions
        });
        await recordServerAuditEntry(deps.GuildAuditLogModel, String(member.guild?.id), {
          userId: requesterId ?? "",
          action: "bot-add-removal-failed",
          details: `botId=${botId}; requesterId=${requesterId ?? "unknown"}; result=removal-failed-hierarchy`
        });
        return;
      }
      deps.metrics?.botAddBlocked();
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
        details: `botId=${botId}; requesterId=${requesterId}; requestId=${permission._id}`
      });
    }
    if (approved) {
      await beginBotObservation(member, botId, requesterId, addedByOwner ? "owner" : "one-time", risk.level, currentTime);
    }
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
    const claim = deps.claimNewAccountAlert ? await deps.claimNewAccountAlert(guildId, user.id) : null;
    if (deps.claimNewAccountAlert && !claim) return;
    const channel = await alertChannel(deps, settings.newAccountAlertChannelId);
    const createdText = typeof user.createdTimestamp === "number" ? new Date(user.createdTimestamp).toISOString() : "necunoscuta";
    const joinedText = typeof member.joinedTimestamp === "number" ? new Date(member.joinedTimestamp).toISOString() : "necunoscuta";
    const outcome = await deliverNewAccountAlert(claim, async () => {
      await channel.send({
        content: [
          `:shield: Cont nou detectat: <@${user.id}> (${user.tag ?? user.id}).`,
          `ID utilizator: ${user.id}.`,
          `Cont creat: ${createdText} (acum ${accountAgeLabel(user.createdTimestamp, now())}).`,
          `Intrat pe server: ${joinedText}.`
        ].join("\n"),
        allowedMentions: { parse: [] }
      });
    });
    if (outcome === "undetermined") {
      deps.logger?.("ERROR", "NEW_ACCOUNT_ALERT", "Alerta cont nou trimisa, dar starea nu a putut fi persistata deloc (nedeterminata); claim-ul ramane blocat pana la reconciliere si NU se retrimite", { guildId, userId: user.id });
    }
  }

  return { handleGuildMemberAdd, beginBotObservation, observeBotMessage };
}
