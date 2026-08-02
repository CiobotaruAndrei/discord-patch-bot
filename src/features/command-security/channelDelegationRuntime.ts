"use strict";

import type { PermissionDelegationRuntimeDeps, AuditMatch, RoleLike, MemberLike, ChannelLike, GuildLike, AuditEntryId, RecordedObservationEvent } from "./permissionDelegationContext.js";
import { AUDIT_LOG_MATCH_WINDOW_MS, auditMatch, channelOverwriteMatch, matchWithRetry, explicitProtectedPermissions, explicitlyHas, grantedProtectedPermissions, protectedMask, requireBitfield, roles, overwrites, CHANNEL_PROTECTED_PERMISSIONS, PROTECTED_PERMISSIONS } from "./permissionDelegationContext.js";
import { recordServerAuditEntry } from "../admin-records/auditLogRepository.js";
import { AuditLogEvent, PermissionFlagsBits } from "discord.js";
import type { SensitiveActionObserver } from "./sensitiveActionObserver.js";
import { createDelegationAuthorizer } from "./delegationAuthorization.js";

export function createChannelDelegationRuntime(deps: PermissionDelegationRuntimeDeps, observer: SensitiveActionObserver) {
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const { observeSensitiveAction, shouldSendIndividualAlert, markProcessed, processedAuditEntries } = observer;
  const authorized = createDelegationAuthorizer(deps);


  async function handleChannelUpdate(previous: ChannelLike, next: ChannelLike): Promise<void> {
    const guild = next.guild;
    if (!guild?.id) return;
    const previousByTarget = new Map(overwrites(previous).map(overwrite => [overwrite.id, overwrite]));
    const violations = overwrites(next)
      .map(overwrite => {
        const before = previousByTarget.get(overwrite.id);
        const allowBits = requireBitfield(overwrite.allow, `overwrite ${overwrite.id} (allow)`);
        const beforeAllowBits = before ? requireBitfield(before.allow, `overwrite ${overwrite.id} (allow anterior)`) : 0n;
        return {
          overwrite,
          granted: CHANNEL_PROTECTED_PERMISSIONS.filter(({ flag }) => explicitlyHas(allowBits, flag) && !explicitlyHas(beforeAllowBits, flag))
        };
      })
      .filter(entry => entry.granted.length > 0);
    if (!violations.length) return;
    const eventTime = now();
    const match = await matchWithRetry(() => channelOverwriteMatch(guild, next.id, eventTime, processedAuditEntries), wait);
    const actorId = match.executorId;
    if (actorId && actorId === guild.ownerId) return;
    const grantedLabels = violations.flatMap(entry => entry.granted.map(({ label }) => label));
    if (await authorized(guild.id, actorId, grantedLabels, next.id)) return;
    const edit = next.permissionOverwrites?.edit;
    if (!edit) throw new Error(`Overwrite-urile canalului ${next.id} nu pot fi restaurate.`);
    markProcessed(match);
    for (const { overwrite, granted } of violations) {
      const before = previousByTarget.get(overwrite.id);
      const beforeDenyBits = before ? requireBitfield(before.deny, `overwrite ${overwrite.id} (deny anterior)`) : 0n;
      const restore: Record<string, boolean | null> = {};
      for (const { flag, option } of granted) {
        restore[option] = explicitlyHas(beforeDenyBits, flag) ? false : null;
      }
      await edit(overwrite.id, restore, { reason: "Protectie anti-delegare: numai ownerul poate acorda permisiuni sensibile prin overwrite de canal" });
    }
    deps.metrics?.reverted(violations.length);
    await recordServerAuditEntry(deps.GuildAuditLogModel, guild.id, {
      userId: actorId ?? "",
      action: "protected-channel-overwrite-reverted",
      details: `channelId=${next.id}; targets=${violations.map(entry => `${entry.overwrite.id}:${entry.granted.map(item => item.option).join("+")}`).join(",")}`
    });
    const observation = await observeSensitiveAction(guild.id, actorId, match, "channel-overwrite", eventTime);
    if (shouldSendIndividualAlert(observation)) await deps.adminAlert(
      "security:permission-delegation",
      "Overwrite de canal cu permisiuni sensibile restaurat",
      `Canal ${next.name ?? next.id}; tinte ${violations.map(entry => entry.overwrite.id).join(", ")}; actor ${actorId ?? "nedetectat"}`,
      guild.id
    );
  }

  async function webhookAuditMatch(guild: GuildLike, channelId: string, eventTime: number): Promise<AuditMatch> {
    for (const type of [AuditLogEvent.WebhookCreate, AuditLogEvent.WebhookUpdate, AuditLogEvent.WebhookDelete]) {
      const logs = await guild.fetchAuditLogs?.({ type, limit: 6 });
      const entries = logs?.entries ? [...logs.entries.values()] : [];
      const candidate = entries
        .filter(entry =>
          entry.extra?.channel?.id === channelId
          && typeof entry.createdTimestamp === "number"
          && Math.abs(eventTime - entry.createdTimestamp) <= AUDIT_LOG_MATCH_WINDOW_MS
          && entry.id !== undefined
          && !processedAuditEntries.has(entry.id)
        )
        .sort((left, right) => Math.abs(eventTime - (left.createdTimestamp ?? 0)) - Math.abs(eventTime - (right.createdTimestamp ?? 0)))[0];
      if (candidate) return { executorId: candidate.executor?.id ?? null, entryId: candidate.id ?? null };
    }
    return { executorId: null, entryId: null };
  }

  async function handleWebhookUpdate(channel: ChannelLike): Promise<void> {
    const guild = channel.guild;
    if (!guild?.id) return;
    const eventTime = now();
    const match = await matchWithRetry(() => webhookAuditMatch(guild, channel.id, eventTime), wait);
    if (!match.executorId || match.entryId === null) return;
    markProcessed(match);
    const observation = await observeSensitiveAction(guild.id, match.executorId, match, "webhook-change", eventTime);
    if (!observation?.observed) return;
    await recordServerAuditEntry(deps.GuildAuditLogModel, guild.id, {
      userId: match.executorId,
      action: "observed-bot-webhook-change",
      details: `channelId=${channel.id}; auditEntryId=${String(match.entryId)}`
    });
    if (shouldSendIndividualAlert(observation)) {
      await deps.adminAlert(
        "security:bot-webhook-observation",
        "Bot monitorizat a modificat un webhook",
        `Bot ${match.executorId}; canal ${channel.id}; actiune atribuita precis prin Audit Log; verificare owner necesara`,
        guild.id
      );
    }
  }


  return { handleChannelUpdate, handleWebhookUpdate };
}
