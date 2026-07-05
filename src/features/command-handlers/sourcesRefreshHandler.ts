"use strict";

import type { CommandHandler } from "../command-registry/commandHandler";
import type { FetchResult, GameConfig } from "../../types";

import { handledCommandError } from "../command-security/commandOutcome";
const { errorDetail, errorMessage } = require("../../shared/errors") as typeof import("../../shared/errors");

type MaybePromise<T> = T | Promise<T>;
type DiscordInteraction = {
  commandName?: string;
  guild?: { id?: string } | null;
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand?: () => boolean;
  reply: (payload: InteractionPayload) => Promise<unknown>;
  followUp?: (payload: InteractionPayload) => Promise<unknown>;
  options: { getSubcommand: () => string; getString: (name: string) => string | null };
};
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, endExtra?: Record<string, unknown>) => void;

interface SourcesRefreshEmbed {
  title: string;
  description: string;
  color: number;
  footer: { text: string };
}
type InteractionPayload = string | { content?: string; embeds?: SourcesRefreshEmbed[]; flags?: number };

interface SourcesRefreshDeps {
  logger: Logger;
  enforceCooldown: (interaction: DiscordInteraction, command: string) => Promise<boolean>;
  startCommandLog: (interaction: DiscordInteraction, command: string, extra?: Record<string, unknown>) => CommandLogEnd;
  safeDefer: (interaction: DiscordInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, payload: InteractionPayload) => Promise<unknown>;
  getLatestForAllGames: (games: GameConfig[], shouldAbort?: (() => boolean) | null) => Promise<FetchResult[]>;
  MessageFlags: { Ephemeral: number };
}

type SourcesRefreshContext = SourcesRefreshDeps & { handleInteraction?: NextInteractionHandler };

function normalizeGameKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findGame(games: GameConfig[], value: string | null): GameConfig | null {
  const input = normalizeGameKey(String(value || ""));
  if (!input) return null;
  return games.find(game =>
    normalizeGameKey(game.key) === input
    || normalizeGameKey(game.name) === input
    || (Array.isArray(game.aliases) && game.aliases.some(alias => normalizeGameKey(String(alias)) === input))
  ) || null;
}

function buildSourcesRefreshEmbed(game: GameConfig, result: FetchResult | null): SourcesRefreshEmbed {
  const outcome = result?.outcome || (result?.error ? "transient-error" : result?.latest ? "ok" : "fara-rezultat");
  const lines: string[] = [`Joc: **${game.name}** (\`${game.key}\`)`, `Rezultat fetch: ${outcome}`];
  if (result?.error) {
    lines.push(`Eroare: ${result.error.slice(0, 300)}`);
  } else if (result?.latest) {
    lines.push(`Titlu: ${result.latest.title.slice(0, 200)}`);
    if (result.latest.link) lines.push(`Link: ${result.latest.link}`);
    if (result.latest.timestamp) lines.push(`Data: ${result.latest.timestamp}`);
  } else {
    lines.push("Sursa a raspuns dar nu a intors niciun update valid.");
  }
  const color = result?.error ? 0xe74c3c : result?.latest ? 0x2ecc71 : 0xf1c40f;
  return {
    title: "Refresh sursa (inspectie live)",
    description: lines.join("\n"),
    color,
    footer: { text: "Fetch live, in afara cache-ului/snapshot-ului. Nu marcheaza update-ul ca vazut si nu trimite notificari." }
  };
}

function createSourcesRefreshHandler(deps: SourcesRefreshDeps) {
  const { enforceCooldown, startCommandLog, safeDefer, safeEdit, getLatestForAllGames } = deps;

  async function handleSourcesRefresh(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    const game = findGame(games, interaction.options.getString("game"));
    if (!game) {
      return safeEdit(interaction, "Eroare: jocul nu exista in lista configurata a botului. Foloseste `/games` pentru cheile valide.");
    }
    if (!(await enforceCooldown(interaction, "sources"))) return undefined;
    const endLog = startCommandLog(interaction, "sources:refresh", { game: game.key });
    await safeDefer(interaction, true);
    const results = await getLatestForAllGames([game], null);
    const result = results.find(entry => entry.game?.key === game.key) || results[0] || null;
    const embed = buildSourcesRefreshEmbed(game, result);
    endLog("ok", { outcome: result?.outcome || (result?.error ? "error" : "none") });
    return safeEdit(interaction, { embeds: [embed] });
  }

  return { handleSourcesRefresh };
}

function isSourcesRefreshCommand(interaction: DiscordInteraction): boolean {
  if (interaction?.isChatInputCommand?.() !== true) return false;
  if (!interaction.guild) return false;
  if (interaction.commandName !== "sources") return false;
  return interaction.options.getSubcommand() === "refresh";
}

function buildSourcesRefreshCommandHandler(target: SourcesRefreshContext) {
  const handlers = createSourcesRefreshHandler({
    logger: target.logger,
    enforceCooldown: target.enforceCooldown,
    startCommandLog: target.startCommandLog,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    getLatestForAllGames: target.getLatestForAllGames,
    MessageFlags: target.MessageFlags
  });
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isSourcesRefreshCommand(interaction as DiscordInteraction),
    handle: async (interaction, games) => {
      try {
        return await handlers.handleSourcesRefresh(interaction, games as GameConfig[]);
      } catch (err: unknown) {
        target.logger("ERROR", "SOURCES_REFRESH", "Eroare in /sources refresh", errorDetail(err));
        const payload = { content: `Eroare: ${errorMessage(err)}`, flags: target.MessageFlags.Ephemeral };
        try {
          if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
            await interaction.followUp(payload);
          } else {
            await interaction.reply(payload);
          }
        } catch {  }
        return handledCommandError(errorDetail(err));
      }
    }
  };
  return { handlers, ...command };
}

export = {
  buildCommandHandler: buildSourcesRefreshCommandHandler,
  createSourcesRefreshHandler,
  buildSourcesRefreshEmbed
};
