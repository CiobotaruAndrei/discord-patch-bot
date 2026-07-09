"use strict";

import type { CurrencyCode, DiscordReplyPayload, GameConfig, GuildSettings, MongoWriteOutcome, PriceAlertRule } from "../../types";
import {
  MAX_PRICE_ALERTS_PER_GUILD,
  buildPriceAlertRule,
  buildPriceAlertUpsertPipeline,
  removePriceAlertsForGame,
  upsertPriceAlert
} from "../notifications/priceAlertRepository";
import type { CommandHandler } from "../command-registry/commandHandler";
import { clampJoinedList } from "../command-presentation/discordListLimit";

import { handledCommandError } from "../command-security/commandOutcome";
const { errorDetail } = require("../../shared/errors") as typeof import("../../shared/errors");

type InteractionPayload = DiscordReplyPayload;
type MongoWriteResult = MongoWriteOutcome;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

interface DiscordInteraction {
  commandName?: string;
  guild?: { id: string } | null;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getSubcommand(): string;
    getString(name: string, required?: boolean): string | null;
    getNumber(name: string, required?: boolean): number | null;
  };
  isChatInputCommand?: () => boolean;
  reply?: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
}

interface PriceAlertInteractionDeps {
  GuildModel: {
    updateOne(
      filter: Record<string, unknown>,
      update: Record<string, unknown> | Array<Record<string, unknown>>,
      options?: Record<string, unknown>
    ): Promise<MongoWriteResult>;
    findOneAndUpdate(
      filter: Record<string, unknown>,
      update: Record<string, unknown> | Array<Record<string, unknown>>,
      options?: Record<string, unknown>
    ): Promise<{ priceAlerts?: PriceAlertRule[] } | null>;
  };
  getGuildSettings(guildId: string): Promise<GuildSettings | null>;
  invalidateGuildCache(guildId: string): void;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: InteractionPayload): Promise<unknown>;
  formatUserError(err: unknown, fallback: string): string;
  SUPPORTED_CURRENCIES: Record<string, unknown>;
  logger: Logger;
  MessageFlags: { Ephemeral: number };
}

type PriceAlertContext = PriceAlertInteractionDeps & {
  handleInteraction?: (interaction: DiscordInteraction, games: GameConfig[]) => Promise<unknown> | unknown;
};

function formatAlertLine(alert: PriceAlertRule, index: number): string {
  const state = alert.triggeredAt ? "declansata, asteapta rearmare" : "armata";
  const observed = typeof alert.lastObservedPrice === "number"
    ? `, ultimul pret ${alert.lastObservedPrice} ${alert.currency}`
    : "";
  return `${index + 1}. **${alert.gameName}** (\`${alert.gameKey}\`) - prag **${alert.threshold} ${alert.currency}** - ${state}${observed}`;
}

function createPriceAlertInteractionHandler(deps: PriceAlertInteractionDeps) {
  const {
    GuildModel, getGuildSettings, invalidateGuildCache, safeDefer, safeEdit,
    formatUserError, SUPPORTED_CURRENCIES
  } = deps;

  async function handleAdd(interaction: DiscordInteraction, games: GameConfig[], guildId: string): Promise<unknown> {
    const gameKey = interaction.options.getString("joc", true);
    const threshold = interaction.options.getNumber("price", true);
    const currency = interaction.options.getString("currency", true);
    const game = games.find(candidate => candidate.key === gameKey);
    if (!game) {
      return safeEdit(interaction, `Eroare: jocul \`${gameKey}\` nu exista. Foloseste autocomplete sau \`/games\`.`);
    }
    if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0.01 || threshold > 10000) {
      return safeEdit(interaction, "Eroare: `price` trebuie sa fie intre 0.01 si 10000.");
    }
    if (!currency || !(currency in SUPPORTED_CURRENCIES)) {
      return safeEdit(interaction, `Eroare: valuta trebuie sa fie una dintre ${Object.keys(SUPPORTED_CURRENCIES).join(", ")}.`);
    }
    const settings = await getGuildSettings(guildId);
    const existing = Array.isArray(settings?.priceAlerts) ? settings.priceAlerts : [];
    const replacesExisting = existing.some(alert => alert.gameKey === game.key && alert.currency === currency);
    if (!replacesExisting && existing.length >= MAX_PRICE_ALERTS_PER_GUILD) {
      return safeEdit(interaction, `Eroare: serverul are deja limita de ${MAX_PRICE_ALERTS_PER_GUILD} alerte de pret.`);
    }
    const rule = buildPriceAlertRule(game, threshold, currency);
    const { saved } = await upsertPriceAlert(GuildModel, guildId, rule, MAX_PRICE_ALERTS_PER_GUILD);
    invalidateGuildCache(guildId);
    if (!saved) {
      return safeEdit(interaction, `Eroare: serverul are deja limita de ${MAX_PRICE_ALERTS_PER_GUILD} alerte de pret (o comanda concurenta a ocupat ultimul loc). Sterge o alerta cu \`/remove price-alert\` si reincearca.`);
    }
    const activation = settings?.discountsSubscribed && settings.discountChannelId
      ? `Alerta va fi trimisa in <#${settings.discountChannelId}>.`
      : "Alerta este salvata, dar devine activa dupa `/start reduceri`, care stabileste canalul de livrare.";
    return safeEdit(interaction, `OK: alerta pentru **${game.name}** setata la **${threshold} ${currency}**. ${activation}`);
  }

  async function handleRemove(interaction: DiscordInteraction, games: GameConfig[], guildId: string): Promise<unknown> {
    const gameKey = interaction.options.getString("joc", true) || "";
    const game = games.find(candidate => candidate.key === gameKey);
    const removedCount = await removePriceAlertsForGame(GuildModel, guildId, gameKey);
    invalidateGuildCache(guildId);
    if (removedCount === 0) {
      return safeEdit(interaction, `Info: nu exista nicio alerta de pret pentru \`${gameKey}\`.`);
    }
    return safeEdit(interaction, `OK: toate alertele de pret pentru **${game?.name || gameKey}** au fost sterse.`);
  }

  async function handleList(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const settings = await getGuildSettings(guildId);
    const alerts = Array.isArray(settings?.priceAlerts) ? settings.priceAlerts : [];
    if (!alerts.length) {
      return safeEdit(interaction, "Nu exista alerte de pret configurate. Adauga una cu `/add price-alert`.");
    }
    const header = `Alerte de pret (${alerts.length}/${MAX_PRICE_ALERTS_PER_GUILD}):\n`;
    return safeEdit(interaction, `${header}${clampJoinedList(alerts.map(formatAlertLine), 2000 - header.length)}`);
  }

  async function handlePriceAlertInteraction(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    await safeDefer(interaction, true);
    const cmd = interaction.commandName;
    const subcommand = cmd === "add" || cmd === "remove" ? cmd : interaction.options.getSubcommand();
    try {
      if (subcommand === "add") return await handleAdd(interaction, games, guildId);
      if (subcommand === "remove") return await handleRemove(interaction, games, guildId);
      if (subcommand === "list") return await handleList(interaction, guildId);
      return safeEdit(interaction, `Eroare: subcomanda \`/price-alert ${subcommand}\` nu este recunoscuta.`);
    } catch (err: unknown) {
      deps.logger("WARN", "PRICE_ALERT_COMMAND", "Nu am putut modifica alertele de pret", errorDetail(err));
      await safeEdit(interaction, formatUserError(err, "Eroare la modificarea alertelor de pret."));
      return handledCommandError(errorDetail(err));
    }
  }

  return { handlePriceAlertInteraction };
}

function isPriceAlertCommand(interaction: DiscordInteraction): boolean {
  if (!(interaction?.isChatInputCommand?.() === true && Boolean(interaction.guild))) return false;
  if (interaction.commandName === "price-alert") return true;
  const cmd = interaction.commandName;
  if (cmd !== "add" && cmd !== "remove") return false;
  try {
    return interaction.options.getSubcommand() === "price-alert";
  } catch {
    return false;
  }
}

function buildPriceAlertCommandHandler(target: PriceAlertContext) {
  const handlers = createPriceAlertInteractionHandler(target);
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isPriceAlertCommand(interaction as DiscordInteraction),
    handle: async (interaction, games) => {
      try {
        return await handlers.handlePriceAlertInteraction(interaction, games);
      } catch (err: unknown) {
        target.logger("ERROR", "PRICE_ALERT_COMMAND", "Eroare neasteptata in /price-alert", errorDetail(err));
        const payload = { content: "Eroare: nu am putut procesa comanda /price-alert.", flags: target.MessageFlags.Ephemeral };
        try {
          if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
            await interaction.followUp(payload);
          } else if (typeof interaction.reply === "function") {
            await interaction.reply(payload);
          }
        } catch {}
        return handledCommandError(errorDetail(err));
      }
    }
  };
  return { handlers, ...command };
}

export = {
  createPriceAlertInteractionHandler,
  buildPriceAlertRule,
  buildPriceAlertUpsertPipeline,
  buildCommandHandler: buildPriceAlertCommandHandler
};
