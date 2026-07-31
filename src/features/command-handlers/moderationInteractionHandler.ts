"use strict";

import type {
  AlwaysReplies,
  AttachmentOption,
  ChatInputInteraction,
  IntegerOption,
  OptionalChannelOption,
  StringOption,
  SubcommandOption,
  UserOption
} from "./discordInteractionPorts.js";
import { randomUUID } from "node:crypto";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { handledCommandError } from "../command-security/commandOutcome.js";
import { errorDetail } from "../../shared/errors.js";
import moderationRepository from "../moderation/moderationRepository.js";
import type { ModerationGuildModel } from "../moderation/moderationRepository.js";
import { createModerationStore } from "../moderation/moderationStore.js";
import { journaledSliceCopy } from "../admin-records/journaledSliceCopy.js";

import type { OperationJournalModelLike } from "../../shared/operationJournalEngine.js";
import { attachmentLabel, validateModerationText, type DirectAttachment } from "../moderation/moderationInputPolicy.js";
import { sendTextPages } from "../command-presentation/textPagination.js";
import {
  applyModerationCommand,
  type ModerationCommand,
  type ModerationDeps,
  type WarningChannel
} from "../moderation/moderationSanctionUseCase.js";
import { moderationOutcomeMessage } from "../moderation/moderationOutcomeMessages.js";
import { formatModerationRecord, summarizeWarnings, mention } from "../moderation/moderationListView.js";
import {
  botHasPermission,
  missingWarningChannelPermissions,
  parseDuration,
  resolveTargetPort,
  unbanPort,
  type ModerationChannel,
  type ModerationGuild,
  type ModerationMember,
  type ModerationUser
} from "../moderation/moderationInteractionAdapters.js";
import type { MissingDependencyKeys, ExtraDependencyKeys, ExactDependencyKeys } from "../../shared/dependencyKeyContract.js";

type Interaction = ChatInputInteraction<
  Partial<SubcommandOption> & UserOption<ModerationUser> & StringOption & IntegerOption & AttachmentOption<DirectAttachment> & OptionalChannelOption<ModerationChannel>,
  ModerationGuild
> & AlwaysReplies & {
  user?: ModerationUser | null;
  member?: ModerationMember | null;
};
type Deps = {
  GuildModel: Parameters<typeof moderationRepository.getModerationState>[0];
  GuildModerationModel?: ModerationGuildModel;
  OperationJournalModel?: OperationJournalModelLike;
  MessageFlags: { Ephemeral: number };
  getGuildSettings(guildId: string): Promise<{ warningChannelId?: string | null } | null>;
  safeDefer(interaction: Interaction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: Interaction, payload: unknown): Promise<unknown>;
  logger?: (level: string, context: string, message: string, meta?: unknown) => void;
};

const ADMIN_ACTIONS = new Set(["timeout", "remove-timeout", "mute", "unmute", "kick", "ban", "unban", "warn", "remove-warn", "warn-ban-limit"]);
const LIST_ACTIONS = new Set(["timeout-list", "mute-list", "warn-list"]);

function optionUser(interaction: Interaction): ModerationUser | null { return interaction.options.getUser("utilizator", false) ?? interaction.options.getUser("user", false); }
function optionString(interaction: Interaction, primary: string, fallback: string): string | null { return interaction.options.getString(primary, false) ?? interaction.options.getString(fallback, false); }
function optionInteger(interaction: Interaction, primary: string, fallback: string): number | null { return interaction.options.getInteger(primary, false) ?? interaction.options.getInteger(fallback, false); }
function optionAttachment(interaction: Interaction): DirectAttachment | null { return interaction.options.getAttachment?.("atasament", false) ?? interaction.options.getAttachment?.("attachment", false) ?? null; }

function createModerationInteractionHandler(deps: Deps) {
  const { MessageFlags, safeDefer, safeEdit } = deps;
  const GuildModel = deps.GuildModerationModel
    ? createModerationStore(
      deps.GuildModel,
      deps.GuildModerationModel,
      guildId => {
        deps.logger?.("INFO", "MODERATION_STORE", "Starea de moderare a fost mutata in colectia dedicata", { guildId });
      },
      journaledSliceCopy({
        OperationJournalModel: deps.OperationJournalModel,
        domain: "moderation",
        dedicatedModel: deps.GuildModerationModel,
        logger: deps.logger
      })
    )
    : deps.GuildModel;

  async function handleLists(interaction: Interaction, command: string, guildId: string): Promise<unknown> {
    const state = await moderationRepository.getModerationState(GuildModel, guildId);
    const records = command === "timeout-list" ? state.moderationTimeouts : command === "mute-list" ? state.moderationMutes : undefined;
    const rows = records ? records.map(record => formatModerationRecord(record)) : summarizeWarnings(state.moderationWarnings ?? []);
    return sendTextPages(interaction, rows, "Lista este goala.", true);
  }

  function warningChannelPort(interaction: Interaction, guild: ModerationGuild, user: ModerationUser | null): () => Promise<WarningChannel> {
    return async () => {
      const settings = await deps.getGuildSettings(guild.id);
      let channel = settings?.warningChannelId && guild.channels?.fetch
        ? await guild.channels.fetch(settings.warningChannelId).catch(() => null)
        : null;
      if (!channel?.send) {
        const selected = interaction.options.getChannel?.("canal", false) ?? null;
        if (!selected) return { status: "not-selected" };
        const missing = missingWarningChannelPermissions(selected, guild.members.me);
        if (missing.length > 0) return { status: "missing-permissions", missing };
        if (!selected.id) return { status: "without-id" };
        await moderationRepository.setWarningChannel(GuildModel, guild.id, selected.id);
        channel = selected;
      }
      const send = typeof channel.send === "function" ? channel.send.bind(channel) : null;
      if (!send) return { status: "unavailable" };
      const attachment = optionAttachment(interaction);
      const moderatorId = interaction.user?.id || "";
      return {
        status: "ready",
        send: (reason, count) => send({
          content: `Warn pentru ${mention(user?.id ?? "", user?.username)} (${count} total) | moderator <@${moderatorId}> | motiv: ${reason ?? "atasament direct"}`,
          files: attachment?.url ? [attachment.url] : [],
          allowedMentions: { parse: [] }
        })
      };
    };
  }

  function useCasePorts(interaction: Interaction, guild: ModerationGuild, user: ModerationUser | null): ModerationDeps {
    const attachment = optionAttachment(interaction);
    const userId = user?.id ?? "";
    const moderatorId = interaction.user?.id || "";
    const actor = { actorId: interaction.user?.id, actorMember: interaction.member };
    return {
      validateReason: raw => validateModerationText(raw),
      discordReason: reason => {
        const value = `${reason ?? ""}${attachmentLabel(attachment)}`.trim();
        return value || undefined;
      },
      botHasPermission: permission => botHasPermission(guild, permission),
      resolveTarget: user ? resolveTargetPort(guild, actor, user.id) : async () => null,
      unbanUser: unbanPort(guild, userId),
      setWarnBanLimit: limit => moderationRepository.setWarnBanLimit(GuildModel, guild.id, limit),
      saveSanction: (command, sanction) => command === "timeout"
        ? moderationRepository.saveTimeout(GuildModel, guild.id, sanction)
        : moderationRepository.saveMute(GuildModel, guild.id, sanction),
      findSanctionsForUser: () => moderationRepository.findModerationRecordsForUser(GuildModel, guild.id, userId),
      removeSanction: field => moderationRepository.removeModeration(GuildModel, guild.id, field, userId),
      removeWarning: () => moderationRepository.removeWarning(GuildModel, guild.id, userId),
      resolveWarningChannel: warningChannelPort(interaction, guild, user),
      addWarning: warningId => moderationRepository.addWarning(GuildModel, guild.id, {
        warningId,
        userId,
        username: user?.username || userId,
        moderatorId,
        warnedAt: new Date()
      }),
      dropWarning: warningId => moderationRepository.removeWarningById(GuildModel, guild.id, warningId).then(() => true),
      newWarningId: () => randomUUID(),
      reportOrphanedWarning: error =>
        deps.logger?.("ERROR", "MODERATION", "Livrarea warn-ului a esuat, iar compensarea nu a putut sterge inregistrarea salvata", errorDetail(error)),
      reportFailedAutoBan: error =>
        deps.logger?.("ERROR", "MODERATION", "Auto-ban-ul dupa warn a esuat; avertismentul ramane valid pentru reconciliere", errorDetail(error)),
      now: () => Date.now()
    };
  }

  async function handle(interaction: Interaction): Promise<unknown> {
    const guild = interaction.guild;
    if (!guild) return interaction.reply({ content: "Eroare: comanda este disponibila doar pe server.", flags: MessageFlags.Ephemeral });
    const command = interaction.commandName || "";
    if (LIST_ACTIONS.has(command)) return handleLists(interaction, command, guild.id);
    await safeDefer(interaction, true);

    const user = optionUser(interaction);
    const outcome = await applyModerationCommand(
      {
        command: command as ModerationCommand,
        rawReason: optionString(interaction, "motiv", "reason") ?? undefined,
        hasAttachment: Boolean(optionAttachment(interaction)),
        duration: parseDuration(optionString(interaction, "durata", "duration") || ""),
        limit: optionInteger(interaction, "numar", "number"),
        userId: user?.id ?? null,
        username: user?.username,
        moderatorId: interaction.user?.id || ""
      },
      useCasePorts(interaction, guild, user)
    );
    return safeEdit(interaction, moderationOutcomeMessage(outcome, mention(user?.id ?? "", user?.username)));
  }
  return { handle };
}

function isModerationCommand(interaction: Interaction): boolean {
  return interaction?.isChatInputCommand?.() === true && Boolean(interaction.guild) && (ADMIN_ACTIONS.has(interaction.commandName || "") || LIST_ACTIONS.has(interaction.commandName || ""));
}

function buildModerationCommandHandler(target: Deps) {
  const handlers = createModerationInteractionHandler(target);
  const command: CommandHandler<Interaction> = {
    canHandle: (interaction): interaction is Interaction => isModerationCommand(interaction as Interaction),
    handle: async interaction => {
      try { return await handlers.handle(interaction); }
      catch (err: unknown) {
        target.logger?.("ERROR", "MODERATION", "Eroare la comanda de moderare", errorDetail(err));
        const payload = { content: "Eroare: nu am putut executa actiunea de moderare.", flags: target.MessageFlags.Ephemeral };
        try {
          if ((interaction.deferred || interaction.replied) && interaction.followUp) await interaction.followUp(payload);
          else await interaction.reply(payload);
        } catch {}
        return handledCommandError(errorDetail(err));
      }
    }
  };
  return { handlers, ...command };
}

export default { createModerationInteractionHandler, buildCommandHandler: buildModerationCommandHandler };

export const MODERATION_HANDLER_KEYS = [
  "OperationJournalModel",
  "GuildModel",
  "GuildModerationModel",
  "MessageFlags",
  "getGuildSettings",
  "logger",
  "safeDefer",
  "safeEdit"
] as const;

type ModerationKeyCheckDeps = Parameters<typeof buildModerationCommandHandler>[0];
type ModerationMissing = MissingDependencyKeys<ModerationKeyCheckDeps, (typeof MODERATION_HANDLER_KEYS)[number] & string>;
type ModerationExtra = ExtraDependencyKeys<ModerationKeyCheckDeps, (typeof MODERATION_HANDLER_KEYS)[number] & string>;
const moderationKeysComplete: ExactDependencyKeys<ModerationMissing, ModerationExtra> = true;
