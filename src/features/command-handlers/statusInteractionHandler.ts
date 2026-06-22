"use strict";

import type { CommandHandler } from "../command-registry/commandHandler";

const { errorMessage, errorDetail } = require("../../shared/errors");

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string; name: string } & Record<string, unknown>;
type DiscordInteraction = {
  commandName?: string;
  guild?: { id?: unknown } | null;
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand?: () => boolean;
  reply: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
  options: { getString: (name: string) => string | null };
};
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;

type StatusHandlerLogger = (level: string, context: string, message: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, endExtra?: Record<string, unknown>) => void;
type FindGameResult = { game: GameConfig | null; suggestion: GameConfig | null };

type StatusHandlerDeps = {
  logger: StatusHandlerLogger;
  enforceCooldown: (interaction: DiscordInteraction, command: string) => Promise<boolean>;
  startCommandLog: (interaction: DiscordInteraction, command: string, extra?: Record<string, unknown>) => CommandLogEnd;
  safeDefer: (interaction: DiscordInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, payload: unknown) => Promise<unknown>;
  findGameAndSuggestion: (text: unknown, games: GameConfig[]) => FindGameResult;
  fetchGameStatus: (game: GameConfig) => Promise<unknown>;
  MessageFlags: { Ephemeral: number };
};

type StatusContext = StatusHandlerDeps & {
  handleInteraction?: NextInteractionHandler;
};

function createStatusInteractionHandler(deps: StatusHandlerDeps) {
  const {
    logger, enforceCooldown, startCommandLog, safeDefer, safeEdit,
    findGameAndSuggestion, fetchGameStatus, MessageFlags
  } = deps;

  async function handleStatusInteraction(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    const gameText = interaction.options.getString("joc");
    if (!gameText) {
      return interaction.reply({ content: "Eroare: Trebuie sa specifici un joc.", flags: MessageFlags.Ephemeral });
    }
    if (!(await enforceCooldown(interaction, "status"))) return;
    const endLog = startCommandLog(interaction, "status", { query: gameText });
    await safeDefer(interaction);
    await safeEdit(interaction, `Se incarca: *Verific statusul serverelor pentru **${gameText}**...*`);
    const { game, suggestion } = findGameAndSuggestion(gameText, games);
    if (!game) {
      endLog("not_found", { suggestion: suggestion?.key });
      let errText = "Eroare: Nu am gasit jocul in baza mea de date.";
      if (suggestion) errText += ` Te refereai cumva la **${suggestion.name}** (\`${suggestion.key}\`)?`;
      return safeEdit(interaction, errText);
    }
    try {
      const embed = await fetchGameStatus(game);
      endLog("ok", { gameKey: game.key });
      return safeEdit(interaction, { content: `OK: Informatii preluate pentru **${game.name}**:`, embeds: [embed] });
    } catch (err: unknown) {
      endLog("error", { gameKey: game.key, errorMsg: errorMessage(err) });
      logger("ERROR", "STATUS", "Eroare la comanda status", errorMessage(err));
      return safeEdit(interaction, "Eroare: A aparut o eroare la preluarea statusului. `[ERR_STATUS_GENERAL]`");
    }
  }

  return { handleStatusInteraction };
}

function isStatusCommand(interaction: DiscordInteraction): boolean {
  return interaction?.isChatInputCommand?.() === true
    && Boolean(interaction.guild)
    && interaction.commandName === "status";
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }) {
  return {
    content: "Eroare: Eroare neasteptata la procesarea comenzii.",
    flags: MessageFlags.Ephemeral
  };
}

function buildStatusCommandHandler(target: StatusContext) {
  const handlers = createStatusInteractionHandler({
    logger: target.logger,
    enforceCooldown: target.enforceCooldown,
    startCommandLog: target.startCommandLog,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    findGameAndSuggestion: target.findGameAndSuggestion,
    fetchGameStatus: target.fetchGameStatus,
    MessageFlags: target.MessageFlags
  });
  const command: CommandHandler = {
    canHandle: (interaction) => isStatusCommand(interaction as DiscordInteraction),
    handle: async (interaction, games) => {
      const di = interaction as DiscordInteraction;
      try {
        return await handlers.handleStatusInteraction(di, games as GameConfig[]);
      } catch (err: unknown) {
        target.logger?.("ERROR", "STATUS_INTERACTION", "Eroare in handler-ul /status", errorDetail(err));
        const payload = createInteractionErrorPayload(target.MessageFlags);
        try {
          if ((di.deferred || di.replied) && typeof di.followUp === "function") {
            await di.followUp(payload);
          } else {
            await di.reply(payload);
          }
        } catch {  }
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

function installStatusInteraction(target: StatusContext) {
  const previousHandleInteraction = target.handleInteraction;
  const { handlers, canHandle, handle } = buildStatusCommandHandler(target);

  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!canHandle(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    return handle(interaction, games);
  }

  Object.assign(target, handlers, { handleInteraction });
}

export = Object.assign(installStatusInteraction, { createStatusInteractionHandler, buildCommandHandler: buildStatusCommandHandler });
