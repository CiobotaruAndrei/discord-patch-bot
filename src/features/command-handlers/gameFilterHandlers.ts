"use strict";

const { errorDetail } = require("../../shared/errors");

type DiscordInteraction = any;
type GameConfig = { key: string; name: string } & Record<string, any>;
type MaybePromise<T> = T | Promise<T>;

type GameFilterInteractionDeps = {
  GuildModel: {
    updateOne: (...args: any[]) => Promise<any>;
  };
  logger?: (...args: any[]) => void;
  getGuildSettings: (guildId: string) => Promise<any>;
  invalidateGuildCache: (guildId: string) => void;
  safeDefer: (interaction: DiscordInteraction) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, payload: any) => Promise<any>;
  formatUserError: (err: unknown, fallback: string) => string;
  MessageFlags: { Ephemeral: number };
};

type GameFilterContext = GameFilterInteractionDeps & {
  handleInteraction?: (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;
};

function createGameFilterInteractionHandlers(deps: GameFilterInteractionDeps) {
  const { GuildModel, getGuildSettings, invalidateGuildCache, safeDefer, safeEdit, formatUserError, logger } = deps;

  async function handleSetGames(interaction: DiscordInteraction, games: GameConfig[], sub: string, guildId: string) {
    if (sub === "list") {
      const guild = await getGuildSettings(guildId);
      const enabled = Array.isArray(guild?.enabledGames) ? guild.enabledGames : [];
      if (enabled.length === 0) {
        return safeEdit(interaction, "OK: Filtru per-joc: **dezactivat** (toate jocurile configurate sunt active).");
      }
      const lines = enabled.map((key: any) => {
        const game = games.find((candidate: any) => candidate.key === key);
        return game ? `- **${game.name}** (\`${game.key}\`)` : `- \`${key}\` *(cheie necunoscuta in config)*`;
      });
      return safeEdit(interaction, `OK: Jocuri active explicit (${enabled.length}):\n` + lines.join("\n"));
    }

    if (sub === "reset") {
      try {
        await GuildModel.updateOne({ _id: guildId }, { $set: { enabledGames: [] } }, { upsert: true });
        invalidateGuildCache(guildId);
        return safeEdit(interaction, "OK: Filtru per-joc resetat. Toate jocurile sunt active.");
      } catch (err: any) {
        return safeEdit(interaction, formatUserError(err, "Eroare la resetare."));
      }
    }

    const gameKey = interaction.options.getString("joc");
    const game = games.find(candidate => candidate.key === gameKey);

    try {
      if (sub === "add") {
        // V11: pentru `add` validam stricta — nu vrem chei aleatorii in enabledGames.
        if (!game) {
          return safeEdit(interaction, `Eroare: Cheia \`${gameKey}\` nu exista in config. Foloseste \`/games\` pentru a vedea cheile valide.`);
        }
        await GuildModel.updateOne(
          { _id: guildId },
          { $addToSet: { enabledGames: gameKey } },
          { upsert: true }
        );
        invalidateGuildCache(guildId);
        return safeEdit(interaction, `OK: **${game.name}** adaugat la lista activa.`);
      }
      if (sub === "remove") {
        // V11: pentru `remove` NU validam stricta — daca operatorul a sters un
        // joc din config dar guild-uri vechi inca au cheia in `enabledGames`,
        // trebuie sa o poata scoate. Vechea forma respingea cu "Cheia ... nu
        // exista in config" si lasa intrarea stale inghetata in DB pentru
        // totdeauna. $pull pe o cheie inexistenta in array este no-op safe.
        // Acelasi fix a fost aplicat anterior pe `legacyInteractionRouter.ts`,
        // dar acel handler e shadow-ed in chain de installer-ul curent
        // (gameFilterHandlers intercepteaza `/set games *` inainte sa ajunga
        // la legacy), deci fix-ul trebuie sa traiasca aici ca sa fie efectiv.
        const result = await GuildModel.updateOne(
          { _id: guildId },
          { $pull: { enabledGames: gameKey } }
        );
        invalidateGuildCache(guildId);
        const displayName = game ? game.name : String(gameKey);
        const note = game ? "" : " *(cheie nu mai exista in config — am curatat-o)*";
        if (result.modifiedCount === 0) {
          return safeEdit(interaction, `Info: **${displayName}** nu era in lista activa, nimic de scos.`);
        }
        return safeEdit(interaction, `OK: **${displayName}** scos din lista activa.${note}`);
      }
    } catch (err: any) {
      return safeEdit(interaction, formatUserError(err, "Eroare la modificarea listei de jocuri."));
    }
    // V11: orice sub-comanda care nu e add / remove / list / reset cade aici.
    // Vechea forma iesea fara reply explicit si user-ul ramanea cu loading-ul
    // pe deferReply.
    logger?.("WARN", "SET_GAMES", `Subcomanda /set games necunoscuta: ${sub}`);
    return safeEdit(interaction, `Eroare: Subcomanda \`/set games ${sub}\` nu este recunoscuta.`);
  }

  async function handleSetGamesInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();
    await safeDefer(interaction);
    return handleSetGames(interaction, games, sub, guildId);
  }

  return { handleSetGames, handleSetGamesInteraction };
}

function isSetGamesCommand(interaction: DiscordInteraction) {
  return interaction?.isChatInputCommand?.() === true
    && interaction.guild
    && interaction.commandName === "set"
    && interaction.options?.getSubcommandGroup?.(false) === "games";
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }) {
  return {
    content: "Eroare: Eroare neasteptata la procesarea comenzii.",
    flags: MessageFlags.Ephemeral
  };
}

function installGameFilterInteractions(ctx: GameFilterContext) {
  const previousHandleInteraction = ctx.handleInteraction;
  const handlers = createGameFilterInteractionHandlers(ctx);

  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!isSetGamesCommand(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }

    try {
      // V11: `return await` ca rejecturile asincrone sa fie prinse de catch,
      // altfel try-catch-ul nu observa promisiunea respinsa din interior.
      return await handlers.handleSetGamesInteraction(interaction, games);
    } catch (err: any) {
      ctx.logger?.("ERROR", "GAME_FILTER_INTERACTION", "Eroare in handler-ul /set games", errorDetail(err));
      const payload = createInteractionErrorPayload(ctx.MessageFlags);
      try {
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
        else await interaction.reply(payload);
      } catch { /* ignore */ }
      return undefined;
    }
  }

  Object.assign(ctx, handlers, { handleInteraction });
}

Object.assign(installGameFilterInteractions, { createGameFilterInteractionHandlers });

export = installGameFilterInteractions;
