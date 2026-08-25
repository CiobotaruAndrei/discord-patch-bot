"use strict";

import { PermissionFlagsBits } from "discord.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { errorDetail } from "../../shared/errors.js";
import {
  applyGuildConfigUpdate,
  setLockedChannelPermissionState,
  type GuildConfigWriteModelLike,
  type LockedChannelPermissionState
} from "../guild-config/guildConfigRepository.js";
import { accountAgeLabel, isRecentAccount } from "../command-security/recentAccountPolicy.js";
import { validateModerationText, type DirectAttachment } from "../moderation/moderationInputPolicy.js";
import { createNewAccountAlertDelivery, deliverNewAccountAlert, type NewAccountAlertClaim, type NewAccountAlertDeliveryModelLike } from "../command-security/newAccountAlertDedup.js";
import { recordChannelLockDivergence, type ChannelLockRecoveryModelLike } from "../command-security/channelLockRecoveryRepository.js";
import { readLockedChannelPermissionState } from "../command-security/channelLockRecoveryRuntime.js";
import { randomUUID } from "node:crypto";
import { setSecurityChannel } from "../command-security/setSecurityChannelUseCase.js";
import { protectionToggleGate } from "../command-security/protectionReadiness.js";
import { runAntiRaidThresholdsCommand } from "./antiRaidThresholdsCommand.js";
import {
  backfillAccountAlerts,
  botChannelPermissions,
  channelBulkDelete,
  isSecurityInteraction,
  missingChannelPermissions,
  permissionState,
  permissionValue,
  resultSize,
  revertOverwriteWithRetry,
  sendExistingAccountAlerts
} from "../command-security/securityInteractionAdapters.js";
import { securityRepositories } from "../command-security/securityCommandRepositories.js";
import { SET_CHANNEL_FIELDS, START_STOP_TOGGLE_FIELDS } from "../command-security/securityCommandFields.js";
import { createPermissionRequestRepository } from "../command-security/permissionRequestRepository.js";
import { createAdProtectionRepository } from "../command-security/adProtectionRepository.js";
import { protectionStopActions } from "../command-security/protectionStopActions.js";
import { captureBaselineOnStart } from "../command-security/antiRaidBaselineTrigger.js";
import type {
  AccountAlertClaimFn,
  OverwriteEditor,
  SecurityDeps,
  SecurityInteraction
} from "../command-security/securityInteractionContracts.js";
import { applyChannelLock, type ChannelLockOutcome } from "../command-security/channelLockUseCase.js";
import { purgeMessages } from "../command-security/purgeMessagesUseCase.js";
import { toggleProtection } from "../command-security/toggleProtectionUseCase.js";
import {
  renderChannelLockOutcome,
  renderPurgeOutcome,
  renderSetChannelOutcome,
  renderToggleProtectionOutcome
} from "../command-presentation/securityCommandMessages.js";
import { createSecurityStore, type SecurityStateModel } from "../command-security/securityStore.js";
import { journaledSliceCopy } from "../admin-records/journaledSliceCopy.js";

function buildSecurityCommandHandler(deps: SecurityDeps): CommandHandler<SecurityInteraction> {
  const target: SecurityDeps = deps.GuildSecurityModel
    ? {
      ...deps,
      GuildModel: createSecurityStore(
        deps.GuildModel,
        deps.GuildSecurityModel,
        guildId => {
          deps.logger?.("INFO", "SECURITY_STORE", "Starea de securitate a inceput sa fie oglindita in colectia dedicata", { guildId });
        },
        undefined,
        journaledSliceCopy({
          OperationJournalModel: deps.OperationJournalModel,
          domain: "security",
          dedicatedModel: deps.GuildSecurityModel,
          logger: deps.logger
        })
      )
    }
    : deps;
  const { adRequests, guardRequests, raidIncidents } = securityRepositories(target);
  const accountAlertClaim: AccountAlertClaimFn | undefined = target.NewAccountAlertDeliveryModel
    ? createNewAccountAlertDelivery(target.NewAccountAlertDeliveryModel, () => randomUUID()).claim
    : undefined;
  async function respond(interaction: SecurityInteraction, content: string): Promise<unknown> {
    return target.safeEdit(interaction, { content });
  }

  async function handle(interaction: SecurityInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    const guild = interaction.guild;
    await target.safeDefer(interaction, true);
    const command = interaction.commandName;
    if (command === "set" && interaction.options.getSubcommand() === "anti-raid-thresholds") {
      const stored = await target.getGuildSettings(guildId).then(value => ({ ok: true as const, stored: value?.antiRaidThresholds })).catch(() => ({ ok: false as const }));
      return respond(interaction, await runAntiRaidThresholdsCommand(interaction.options, {
        readStored: () => stored,
        persist: async thresholds => { await applyGuildConfigUpdate(target.GuildModel, guildId, { antiRaidThresholds: thresholds }); },
        onSaveFailure: error => target.logger?.("WARN", "SECURITY_COMMAND", "Salvarea pragurilor anti-raid a esuat", errorDetail(error)),
        formatError: error => target.formatUserError(error, "Eroare la salvare.")
      }));
    }
    if (command === "set") {
      const channel = interaction.options.getChannel("canal", false) ?? interaction.options.getChannel("channel", true);
      const outcome = await setSecurityChannel(
        {
          guildId,
          field: SET_CHANNEL_FIELDS[interaction.options.getSubcommand()],
          channelId: channel?.id
        },
        {
          readPermissions: channelId => target.checkChannelPermissions(interaction, channelId),
          persist: async (id, field, channelId) => {
            await applyGuildConfigUpdate(target.GuildModel, id, { [field]: channelId });
          }
        }
      );
      if (outcome.kind === "save-failed") {
        target.logger?.("WARN", "SECURITY_COMMAND", "Salvarea setarii de securitate a esuat", errorDetail(outcome.error));
      }
      const message = renderSetChannelOutcome(outcome, error => target.formatUserError(error, "Eroare la salvarea setarii."));
      return message === null ? undefined : respond(interaction, message);
    }
    if (command === "start" || command === "stop") {
      const sub = interaction.options.getSubcommand();
      const toggle = START_STOP_TOGGLE_FIELDS[sub];
      if (!toggle) return undefined;
      const toggleGate = protectionToggleGate(interaction, sub);
      const settings = await target.getGuildSettings(guildId).catch(() => null);
      const stopActions = protectionStopActions(sub, guildId, {
        guardRequests,
        adRequests,
        raidIncidents,
        disableProtection: async () => {
          await applyGuildConfigUpdate(target.GuildModel, guildId, { [toggle.enabled]: false });
        }
      });
      const outcome = await toggleProtection(
        {
          command, subcommand: sub, hasToggleFields: true, ...toggleGate,
          needsAtomicStop: stopActions.needsAtomicStop, needsActiveIncident: stopActions.needsActiveIncident,
          needsBackfill: sub === "new-account-alerts" && settings?.newAccountAlertsEnabled !== true },
        {
          readConfiguredChannel: () => {
            const channelId = settings?.[toggle.channel]
              ?? (sub === "anti-raid" || sub === "anti-raid-dry-run" ? settings?.permissionRequestChannelId : null);
            return typeof channelId === "string" && channelId ? channelId : null;
          },
          readChannelPermissions: channelId => target.checkChannelPermissions(interaction, channelId),
          readiness: toggleGate,
          countActiveApprovals: stopActions.countActiveApprovals,
          stopAtomically: stopActions.stopAtomically,
          readStopRefusal: stopActions.readStopRefusal,
          persistEnabled: async enabled => {
            await applyGuildConfigUpdate(target.GuildModel, guildId, { [toggle.enabled]: enabled });
          },
          runBackfill: () => backfillAccountAlerts(interaction, settings?.newAccountAlertChannelId, guildId, accountAlertClaim, target.logger)
        }
      );
      if (outcome.kind === "atomic-stop-failed") {
        target.logger?.("WARN", "SECURITY_COMMAND", "Anularea aprobarilor bot-add active a esuat", errorDetail(outcome.error));
      }
      await captureBaselineOnStart(outcome, command, sub, guildId, { ...target, errorDetail });
      const message = renderToggleProtectionOutcome(outcome);
      return message === null ? undefined : respond(interaction, message);
    }
    if (command === "lock-channel" || command === "unlock-channel") {
      const channel = interaction.options.getChannel("canal", false) ?? interaction.options.getChannel("channel", true);
      const everyone = guild?.roles?.everyone;
      const overwrites = channel?.permissionOverwrites;
      const channelId = channel?.id;
      const renderLock = (outcome: ChannelLockOutcome): string => renderChannelLockOutcome(outcome, {
        channelId: channelId ?? "",
        formatError: error => target.formatUserError(error, "Eroare la modificarea permisiunilor canalului.")
      });
      if (!channel || !channelId || !overwrites?.edit || !everyone) {
        return respond(interaction, renderLock({ kind: "channel-not-editable" }));
      }

      const editOverwrite: OverwriteEditor = (roleTarget, permissions) => overwrites.edit(roleTarget, permissions);
      const attachment = command === "lock-channel" ? interaction.options.getAttachment?.("atasament", false) ?? null : null;
      const currentSettings = await target.getGuildSettings(guildId).catch(() => null);
      const previous = command === "lock-channel"
        ? permissionState(channel, everyone.id)
        : currentSettings?.lockedChannelPermissions?.find(item => item.channelId === channelId)?.sendMessages;
      const unlockedValue = previous ? permissionValue(previous) : null;

      const outcome = await applyChannelLock(
        {
          command,
          rawReason: command === "lock-channel"
            ? (interaction.options.getString("motiv", false) ?? interaction.options.getString("reason", false))
            : null,
          hasAttachment: Boolean(attachment),
          isLocked: currentSettings?.lockedChannelIds?.includes(channelId) === true
        },
        {
          canEditOverwrites: () => true,
          readBotPermissions: () => {
            const perms = botChannelPermissions(channel, guild);
            if (!perms) return null;
            const required = [
              { flag: PermissionFlagsBits.ViewChannel, label: "View Channel" },
              { flag: PermissionFlagsBits.ManageChannels, label: "Manage Channels" },
              { flag: PermissionFlagsBits.ManageRoles, label: "Manage Roles (Manage Permissions)" }
            ];
            if (command === "lock-channel") required.push({ flag: PermissionFlagsBits.SendMessages, label: "Send Messages" });
            return { missing: missingChannelPermissions(perms, required) };
          },
          canSendNotice: () => typeof channel.send === "function",
          validateReason: raw => validateModerationText(raw ?? undefined),
          readPreviousState: () => previous,
          applyOverwrite: async locked => {
            await editOverwrite(everyone, { SendMessages: locked ? false : unlockedValue });
          },
          persistState: (previousState, locked) =>
            setLockedChannelPermissionState(target.GuildModel, guildId, channelId, previousState, locked).then(() => undefined),
          revertOverwrite: locked => revertOverwriteWithRetry(editOverwrite, everyone, locked ? false : unlockedValue),
          recordDivergence: async previousState => target.ChannelLockRecoveryModel
            ? await recordChannelLockDivergence(target.ChannelLockRecoveryModel, {
              guildId,
              channelId,
              command,
              previousState,
              divergedState: command === "lock-channel" ? "deny" : previousState,
              desiredState: command === "lock-channel" ? previousState : "deny",
              desiredLocked: command !== "lock-channel"
            })
            : false,
          sendNotice: async reason => {
            const send = channel.send;
            if (typeof send !== "function") throw new Error("Canalul nu mai poate primi mesajul de blocare.");
            await send.call(channel, {
              content: ":lock: Canal blocat de <@" + (interaction.user?.id ?? "administrator") + ">. Motiv: " + (reason ?? "atasament direct") + ".",
              files: attachment?.url ? [attachment.url] : [],
              allowedMentions: { parse: [] }
            });
          },
          revertPersistence: previousState =>
            setLockedChannelPermissionState(target.GuildModel, guildId, channelId, previousState, false).then(() => true).catch(() => false)
        }
      );

      if (outcome.kind === "diverged") {
        target.logger?.("ERROR", "LOCK_CHANNEL", "Stare divergenta: persistarea a esuat si rollback-ul permisiunii Discord a esuat si el", { guildId, channelId, command, previous: outcome.previous });
      }
      return respond(interaction, renderLock(outcome));
    }
    if (command === "purge" || command === "purge-amount") {
      const requested = interaction.options.getInteger("numar", false);
      const purgeChannel = interaction.channel;
      const outcome = await purgeMessages(
        { amount: requested ?? (command === "purge" ? 50 : 0) },
        {
          canBulkDelete: () => channelBulkDelete(purgeChannel),
          missingPermissions: () => {
            const perms = purgeChannel ? botChannelPermissions(purgeChannel, guild) : null;
            if (!perms) return [];
            return missingChannelPermissions(perms, [
              { flag: PermissionFlagsBits.ViewChannel, label: "View Channel" },
              { flag: PermissionFlagsBits.ManageMessages, label: "Manage Messages" },
              { flag: PermissionFlagsBits.ReadMessageHistory, label: "Read Message History" }
            ]);
          },
          bulkDelete: async amount => {
            if (!channelBulkDelete(purgeChannel)) return 0;
            return resultSize(await purgeChannel.bulkDelete(amount, true));
          }
        }
      );
      return respond(interaction, renderPurgeOutcome(outcome, error => target.formatUserError(error, "Eroare la stergerea mesajelor.")));
    }
    return undefined;
  }

  return {
    canHandle: (interaction: unknown): interaction is SecurityInteraction => isSecurityInteraction(interaction as SecurityInteraction),
    handle: interaction => handle(interaction)
  };
}

export default { buildCommandHandler: buildSecurityCommandHandler };
