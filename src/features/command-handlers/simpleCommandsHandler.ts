"use strict";

/**
 * V12: handler tipat pentru comenzile trivial-stateless `/ping` si `/games`.
 *
 * Ultima extragere din `legacyInteractionRouter.ts` ca sa retiram complet
 * dispatch-ul vechi. Cele doua comenzi sunt foarte mici si nu au nevoie de
 * suprafata mare pe ctx — `/ping` nu are deps, `/games` are nevoie doar de
 * `COMMAND_OUTPUT_MAX_CHARS` ca sa ramana sub 2000 char-uri Discord pe mesaj.
 */

const { errorDetail } = require("../../shared/errors");

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string; name: string; aliases?: string[] } & Record<string, unknown>;
type DiscordInteraction = {
  commandName?: string;
  guild?: unknown;
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand?: () => boolean;
  reply: (payload: unknown) => Promise<unknown>;
  followUp: (payload: unknown) => Promise<unknown>;
};
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;

type SimpleCommandsDeps = {
  COMMAND_OUTPUT_MAX_CHARS: number;
};

type SimpleCommandsContext = SimpleCommandsDeps & {
  MessageFlags: { Ephemeral: number };
  logger?: (...args: unknown[]) => void;
  handleInteraction?: NextInteractionHandler;
};

function createSimpleCommandsHandler(deps: SimpleCommandsDeps) {
  const { COMMAND_OUTPUT_MAX_CHARS } = deps;

  async function handlePingInteraction(interaction: DiscordInteraction) {
    // V11: eliminat spatiul trailing leftover ("Pong! " → "Pong!").
    return interaction.reply("Pong!");
  }

  async function handleGamesInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    // V12 bug fix: early-return cu mesaj clar cand games este gol. Inainte:
    // legacy router seta `currentMsg = "**Jocuri urmarite:**\n"`, nu intra in
    // loop-ul de lines (gol), apoi `if (currentMsg.trim()) messages.push(...)`
    // pastra header-ul ca singurul item → user-ul vedea doar "**Jocuri
    // urmarite:**" pe Discord, fara nicio intrare. Acum mesaj explicit.
    if (!games.length) return interaction.reply("Nu sunt jocuri configurate.");
    const lines = games.map(g => {
      let item = `- **${g.name}** (\`${g.key}\`)`;
      if (g.aliases && g.aliases.length > 0) item += ` *[Alias: ${g.aliases.join(", ")}]*`;
      return item;
    });
    let currentMsg = "**Jocuri urmarite:**\n";
    const messages: string[] = [];
    for (const line of lines) {
      if (currentMsg.length + line.length > COMMAND_OUTPUT_MAX_CHARS) {
        messages.push(currentMsg);
        currentMsg = "";
      }
      currentMsg += line + "\n";
    }
    if (currentMsg.trim()) messages.push(currentMsg);
    if (!messages.length) return interaction.reply("Nu sunt jocuri configurate.");
    await interaction.reply(messages[0]);
    for (let i = 1; i < messages.length; i++) await interaction.followUp(messages[i]).catch(() => null);
  }

  return { handlePingInteraction, handleGamesInteraction };
}

function isSimpleCommand(interaction: DiscordInteraction): boolean {
  if (interaction?.isChatInputCommand?.() !== true) return false;
  if (!interaction.guild) return false;
  return interaction.commandName === "ping" || interaction.commandName === "games";
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }) {
  return {
    content: "Eroare: Eroare neasteptata la procesarea comenzii.",
    flags: MessageFlags.Ephemeral
  };
}

function installSimpleCommandsHandler(ctx: SimpleCommandsContext) {
  const previousHandleInteraction = ctx.handleInteraction;
  const handlers = createSimpleCommandsHandler(ctx);

  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!isSimpleCommand(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    try {
      if (interaction.commandName === "ping") return await handlers.handlePingInteraction(interaction);
      return await handlers.handleGamesInteraction(interaction, games);
    } catch (err: unknown) {
      ctx.logger?.("ERROR", "SIMPLE_COMMAND", "Eroare in /ping sau /games", errorDetail(err));
      const payload = createInteractionErrorPayload(ctx.MessageFlags);
      try {
        if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch { /* ignore */ }
      return undefined;
    }
  }

  Object.assign(ctx, handlers, { handleInteraction });
}

Object.assign(installSimpleCommandsHandler, { createSimpleCommandsHandler });

export = installSimpleCommandsHandler;
