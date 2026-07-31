"use strict";

import type {
  AlwaysReplies,
  ChatInputInteraction,
  PartialInteractionGuildRef,
  SubcommandOption
} from "./discordInteractionPorts.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { matchesCommand } from "../command-registry/commandMatch.js";
import type { GameConfig } from "../../config/configTypes.js";
import { summarizeSourceHealth, type SourceHealthDoc } from "../../sources/sourceHealth.js";
import {
  buildSourcesStatusEmbed,
  type LoadedDealsFetchSnapshot,
  type LoadedFetchSnapshot,
  type SourcesStatusEmbed
} from "./sourcesStatusView.js";

import { handledCommandError } from "../command-security/commandOutcome.js";
import { errorDetail } from "../../shared/errors.js";
import type { MissingDependencyKeys, ExtraDependencyKeys, ExactDependencyKeys } from "../../shared/dependencyKeyContract.js";

type MaybePromise<T> = T | Promise<T>;
type DiscordInteraction = ChatInputInteraction<SubcommandOption, PartialInteractionGuildRef, InteractionPayload> & AlwaysReplies<InteractionPayload>;
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, endExtra?: Record<string, unknown>) => void;
type InteractionPayload = string | { content?: string; embeds?: SourcesStatusEmbed[]; flags?: number };

interface SourcesStatusDeps {
  logger: Logger;
  enforceCooldown: (interaction: DiscordInteraction, command: string) => Promise<boolean>;
  startCommandLog: (interaction: DiscordInteraction, command: string, extra?: Record<string, unknown>) => CommandLogEnd;
  safeDefer: (interaction: DiscordInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, payload: InteractionPayload) => Promise<unknown>;
  loadFetchSnapshot: (id: string) => Promise<LoadedFetchSnapshot | null>;
  loadDealsFetchSnapshots: () => Promise<LoadedDealsFetchSnapshot[]>;
  loadSourceHealth?: () => Promise<SourceHealthDoc[]>;
  MessageFlags: { Ephemeral: number };
}

type SourcesStatusContext = SourcesStatusDeps;

function createSourcesStatusHandler(deps: SourcesStatusDeps) {
  const { enforceCooldown, startCommandLog, safeDefer, safeEdit, loadFetchSnapshot, loadDealsFetchSnapshots, loadSourceHealth } = deps;

  async function handleSourcesStatus(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    if (!(await enforceCooldown(interaction, "sources"))) return undefined;
    const endLog = startCommandLog(interaction, "sources:status");
    await safeDefer(interaction, true);
    const [updatesSnapshot, dealSnapshots, healthDocs] = await Promise.all([
      loadFetchSnapshot("updates"),
      loadDealsFetchSnapshots(),
      loadSourceHealth ? loadSourceHealth() : Promise.resolve([])
    ]);
    const healthSummary = loadSourceHealth ? summarizeSourceHealth(healthDocs) : null;
    const embed = buildSourcesStatusEmbed(games, updatesSnapshot, dealSnapshots, healthSummary);
    endLog("ok", { dealSnapshots: dealSnapshots.length, unhealthySources: healthSummary ? healthSummary.total - healthSummary.healthy : 0 });
    return safeEdit(interaction, { embeds: [embed] });
  }

  return { handleSourcesStatus };
}

function isSourcesStatusCommand(interaction: DiscordInteraction): boolean {
  return matchesCommand(interaction, { commandNames: ["sources"], subcommand: "status" });
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }): InteractionPayload {
  return { content: "Eroare: Eroare neasteptata la procesarea comenzii.", flags: MessageFlags.Ephemeral };
}

function buildSourcesStatusCommandHandler(target: SourcesStatusContext) {
  const handlers = createSourcesStatusHandler({
    logger: target.logger,
    enforceCooldown: target.enforceCooldown,
    startCommandLog: target.startCommandLog,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    loadFetchSnapshot: target.loadFetchSnapshot,
    loadDealsFetchSnapshots: target.loadDealsFetchSnapshots,
    loadSourceHealth: target.loadSourceHealth,
    MessageFlags: target.MessageFlags
  });
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isSourcesStatusCommand(interaction as DiscordInteraction),
    handle: async (interaction, games) => {
      const di = interaction;
      try {
        return await handlers.handleSourcesStatus(di, games);
      } catch (err: unknown) {
        target.logger?.("ERROR", "SOURCES_STATUS", "Eroare in handler-ul /sources status", errorDetail(err));
        const payload = createInteractionErrorPayload(target.MessageFlags);
        try {
          if ((di.deferred || di.replied) && typeof di.followUp === "function") {
            await di.followUp(payload);
          } else {
            await di.reply(payload);
          }
        } catch {  }
        return handledCommandError(errorDetail(err));
      }
    }
  };
  return { handlers, ...command };
}

export default {
  buildCommandHandler: buildSourcesStatusCommandHandler,
  createSourcesStatusHandler,
  buildSourcesStatusEmbed
};

export const SOURCE_STATUS_HANDLER_KEYS = [
  "MessageFlags",
  "enforceCooldown",
  "loadDealsFetchSnapshots",
  "loadFetchSnapshot",
  "loadSourceHealth",
  "logger",
  "safeDefer",
  "safeEdit",
  "startCommandLog"
] as const;

type SourceStatusKeyCheckDeps = Parameters<typeof buildSourcesStatusCommandHandler>[0];
type SourceStatusMissing = MissingDependencyKeys<SourceStatusKeyCheckDeps, (typeof SOURCE_STATUS_HANDLER_KEYS)[number] & string>;
type SourceStatusExtra = ExtraDependencyKeys<SourceStatusKeyCheckDeps, (typeof SOURCE_STATUS_HANDLER_KEYS)[number] & string>;
const sourceStatusKeysComplete: ExactDependencyKeys<SourceStatusMissing, SourceStatusExtra> = true;
