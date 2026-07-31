"use strict";

import type {
  AlwaysReplies,
  ChatInputInteraction,
  InteractionUserRef,
  StringOption,
  SubcommandOption
} from "./discordInteractionPorts.js";
import type { GameConfig } from "../../config/configTypes.js";
import type { InteractionMessage } from "../command-presentation/paginationTypes.js";
import type { GuildSettings } from "../guild-config/guildSettingsTypes.js";
import type { GameServerStatus } from "../command-presentation/gameStatusEmbeds.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { handledCommandError } from "../command-security/commandOutcome.js";
import { errorMessage, errorDetail } from "../../shared/errors.js";
import type { MissingDependencyKeys, ExtraDependencyKeys, ExactDependencyKeys } from "../../shared/dependencyKeyContract.js";

type DiscordInteraction = ChatInputInteraction<Partial<SubcommandOption> & StringOption> & AlwaysReplies & { user?: InteractionUserRef | null };

type StatusDeclaredKeysDeps = {
  logger(level: string, context: string, message: string, meta?: unknown): void;
  enforceCooldown(interaction: DiscordInteraction, command: string): Promise<boolean>;
  startCommandLog(interaction: DiscordInteraction, command: string, extra?: Record<string, unknown>): (status?: string, endExtra?: Record<string, unknown>) => void;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: unknown): Promise<unknown>;
  findGameAndSuggestion(text: unknown, games: GameConfig[]): { game: GameConfig | null; suggestion: GameConfig | null };
  fetchGameStatus(game: GameConfig): Promise<unknown>;
  fetchGameStatusSummary?(game: GameConfig): Promise<GameServerStatus>;
  getGuildSettings?(guildId: string): Promise<GuildSettings | null>;
  handlePagination?<TItem, TEmbed>(
    message: InteractionMessage,
    authorId: string,
    prefix: string,
    items: TItem[],
    itemsPerPage: number,
    generateEmbeds: (page: number, totalPages: number) => TEmbed[]
  ): Promise<void>;
  MessageFlags: { Ephemeral: number };
};

const STATUS_PAGE_SIZE = 10;

function supportsServerStatus(game: GameConfig): boolean {
  return game.type === "epic_games" || ["roblox", "valorant", "lol", "minecraft"].includes(game.key);
}

function isInteractionMessage(value: unknown): value is InteractionMessage {
  return value !== null
    && typeof value === "object"
    && typeof Reflect.get(value, "edit") === "function"
    && typeof Reflect.get(value, "createMessageComponentCollector") === "function";
}

function stateIcon(state: GameServerStatus["state"]): string {
  if (state === "online") return "🟢";
  if (state === "maintenance") return "🟡";
  if (state === "degraded") return "🟠";
  return "⚪";
}

function createStatusInteractionHandler(deps: StatusDeclaredKeysDeps) {
  const {
    logger, enforceCooldown, startCommandLog, safeDefer, safeEdit,
    findGameAndSuggestion, fetchGameStatus, MessageFlags
  } = deps;

  async function handleGame(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    const gameText = interaction.options.getString("joc");
    if (!gameText) return interaction.reply({ content: "Eroare: Trebuie sa specifici un joc.", flags: MessageFlags.Ephemeral });
    const endLog = startCommandLog(interaction, "status game", { query: gameText });
    await safeDefer(interaction);
    const { game, suggestion } = findGameAndSuggestion(gameText, games);
    if (!game) {
      endLog("not_found", { suggestion: suggestion?.key });
      return safeEdit(interaction, suggestion
        ? `Eroare: Nu am gasit jocul. Te refereai cumva la **${suggestion.name}** (\`${suggestion.key}\`)?`
        : "Eroare: Nu am gasit jocul in baza mea de date.");
    }
    const embed = await fetchGameStatus(game);
    endLog("ok", { gameKey: game.key });
    return safeEdit(interaction, { content: `OK: Informatii preluate pentru **${game.name}**:`, embeds: [embed] });
  }

  async function handleWatchlist(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    const endLog = startCommandLog(interaction, "status watchlist");
    await safeDefer(interaction);
    const settings = deps.getGuildSettings ? await deps.getGuildSettings(guildId) : null;
    const enabled = Array.isArray(settings?.enabledGames) ? new Set(settings.enabledGames) : null;
    const watched = games.filter(game => (!enabled || enabled.size === 0 || enabled.has(game.key)) && supportsServerStatus(game));
    if (!watched.length) {
      endLog("no_supported_games");
      return safeEdit(interaction, "Info: niciun joc din watchlist nu are o sursa de server status integrata.");
    }
    const settled = await Promise.allSettled(watched.map(async game => ({
      game,
      status: deps.fetchGameStatusSummary
        ? await deps.fetchGameStatusSummary(game)
        : { state: "unknown", label: "Necunoscut", detail: "Indisponibil", checkedAt: new Date(), statusUrl: "" } as GameServerStatus
    })));
    const results = settled.map((result, index) => result.status === "fulfilled"
      ? result.value
      : {
          game: watched[index],
          status: { state: "unknown", label: "Necunoscut", detail: errorMessage(result.reason), checkedAt: new Date(), statusUrl: "" } as GameServerStatus
        });
    const render = (page: number, totalPages: number) => {
      const chunk = results.slice(page * STATUS_PAGE_SIZE, (page + 1) * STATUS_PAGE_SIZE);
      return [{
        title: "Status servere pentru watchlist",
        color: 0x5865f2,
        description: chunk.map(item => `${stateIcon(item.status.state)} **${item.game.name}** — ${item.status.label}\nUltima verificare: <t:${Math.floor(item.status.checkedAt.getTime() / 1000)}:R>`).join("\n\n"),
        footer: { text: `Pagina ${page + 1}/${totalPages}` }
      }];
    };
    const message = await safeEdit(interaction, { embeds: render(0, Math.ceil(results.length / STATUS_PAGE_SIZE)) });
    if (isInteractionMessage(message) && interaction.user?.id && deps.handlePagination) await deps.handlePagination(message, interaction.user.id, "status_watchlist", results, STATUS_PAGE_SIZE, render);
    endLog("ok", { count: results.length });
    return message;
  }

  async function handleStatusInteraction(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    const subcommand = interaction.options.getSubcommand?.(false) || "game";
    if (subcommand !== "watchlist" && !interaction.options.getString("joc")) {
      return interaction.reply({ content: "Eroare: Trebuie sa specifici un joc.", flags: MessageFlags.Ephemeral });
    }
    if (!(await enforceCooldown(interaction, "status"))) return undefined;
    return subcommand === "watchlist" ? handleWatchlist(interaction, games) : handleGame(interaction, games);
  }

  return { handleStatusInteraction };
}

function isStatusCommand(interaction: DiscordInteraction): boolean {
  return interaction.isChatInputCommand?.() === true && Boolean(interaction.guild) && interaction.commandName === "status";
}

function buildStatusCommandHandler(target: StatusDeclaredKeysDeps) {
  const handlers = createStatusInteractionHandler(target);
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isStatusCommand(interaction as DiscordInteraction),
    handle: async (interaction, games) => {
      try {
        return await handlers.handleStatusInteraction(interaction, games as GameConfig[]);
      } catch (err: unknown) {
        loggerFailure(target, err);
        const payload = { content: "Eroare: nu am putut verifica starea serverelor.", flags: target.MessageFlags.Ephemeral };
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

function loggerFailure(target: StatusDeclaredKeysDeps, error: unknown): void {
  target.logger("ERROR", "STATUS_INTERACTION", "Eroare in handler-ul /status", errorDetail(error));
}

export default { createStatusInteractionHandler, supportsServerStatus, buildCommandHandler: buildStatusCommandHandler };

export const STATUS_HANDLER_KEYS = [
  "MessageFlags",
  "enforceCooldown",
  "fetchGameStatus",
  "fetchGameStatusSummary",
  "findGameAndSuggestion",
  "getGuildSettings",
  "handlePagination",
  "logger",
  "safeDefer",
  "safeEdit",
  "startCommandLog"
] as const;

type StatusKeyCheckDeps = Parameters<typeof buildStatusCommandHandler>[0];
type StatusMissing = MissingDependencyKeys<StatusKeyCheckDeps, (typeof STATUS_HANDLER_KEYS)[number] & string>;
type StatusExtra = ExtraDependencyKeys<StatusKeyCheckDeps, (typeof STATUS_HANDLER_KEYS)[number] & string>;
const statusKeysComplete: ExactDependencyKeys<StatusMissing, StatusExtra> = true;
