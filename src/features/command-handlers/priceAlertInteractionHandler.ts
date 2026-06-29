"use strict";

import type { CurrencyCode, GameConfig, GuildSettings, PriceAlertRule } from "../../types";
import type { CommandHandler } from "../command-registry/commandHandler";
import { clampJoinedList } from "../command-presentation/discordListLimit";

const { errorDetail } = require("../../shared/errors") as typeof import("../../shared/errors");

type InteractionPayload = string | Record<string, unknown>;
type MongoWriteResult = { matchedCount?: number; modifiedCount?: number };
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

const MAX_PRICE_ALERTS_PER_GUILD = 25;

function buildPriceAlertRule(game: GameConfig, threshold: number, currency: string): PriceAlertRule {
  return {
    gameKey: game.key,
    gameName: game.name,
    appId: typeof game.appId === "string" ? game.appId : "",
    aliases: Array.isArray(game.aliases) ? game.aliases.map(String) : [],
    threshold,
    currency,
    triggeredAt: null,
    lastObservedPrice: null,
    lastObservedAt: null
  };
}

function buildPriceAlertUpsertPipeline(rule: PriceAlertRule, maxAlerts: number): Array<Record<string, unknown>> {
  return [{
    $set: {
      priceAlerts: {
        $let: {
          vars: {
            kept: {
              $filter: {
                input: { $ifNull: ["$priceAlerts", []] },
                as: "alert",
                cond: {
                  $not: {
                    $and: [
                      { $eq: ["$$alert.gameKey", rule.gameKey] },
                      { $eq: ["$$alert.currency", rule.currency] }
                    ]
                  }
                }
              }
            }
          },
          in: {
            $cond: [
              { $lt: [{ $size: "$$kept" }, maxAlerts] },
              { $concatArrays: ["$$kept", [rule]] },
              "$$kept"
            ]
          }
        }
      }
    }
  }];
}

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
    await GuildModel.updateOne(
      { _id: guildId },
      buildPriceAlertUpsertPipeline(rule, MAX_PRICE_ALERTS_PER_GUILD),
      { upsert: true }
    );
    invalidateGuildCache(guildId);
    const activation = settings?.discountsSubscribed && settings.discountChannelId
      ? `Alerta va fi trimisa in <#${settings.discountChannelId}>.`
      : "Alerta este salvata, dar devine activa dupa `/start reduceri`, care stabileste canalul de livrare.";
    return safeEdit(interaction, `OK: alerta pentru **${game.name}** setata la **${threshold} ${currency}**. ${activation}`);
  }

  async function handleRemove(interaction: DiscordInteraction, games: GameConfig[], guildId: string): Promise<unknown> {
    const gameKey = interaction.options.getString("joc", true);
    const game = games.find(candidate => candidate.key === gameKey);
    const result = await GuildModel.updateOne(
      { _id: guildId },
      { $pull: { priceAlerts: { gameKey } } }
    );
    invalidateGuildCache(guildId);
    if ((result.modifiedCount ?? 0) === 0) {
      return safeEdit(interaction, `Info: nu exista nicio alerta de pret pentru \`${gameKey}\`.`);
    }
    return safeEdit(interaction, `OK: toate alertele de pret pentru **${game?.name || gameKey}** au fost sterse.`);
  }

  async function handleList(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const settings = await getGuildSettings(guildId);
    const alerts = Array.isArray(settings?.priceAlerts) ? settings.priceAlerts : [];
    if (!alerts.length) {
      return safeEdit(interaction, "Nu exista alerte de pret configurate. Adauga una cu `/price-alert add`.");
    }
    const header = `Alerte de pret (${alerts.length}/${MAX_PRICE_ALERTS_PER_GUILD}):\n`;
    return safeEdit(interaction, `${header}${clampJoinedList(alerts.map(formatAlertLine), 2000 - header.length)}`);
  }

  async function handlePriceAlertInteraction(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    await safeDefer(interaction, true);
    const subcommand = interaction.options.getSubcommand();
    try {
      if (subcommand === "add") return await handleAdd(interaction, games, guildId);
      if (subcommand === "remove") return await handleRemove(interaction, games, guildId);
      if (subcommand === "list") return await handleList(interaction, guildId);
      return safeEdit(interaction, `Eroare: subcomanda \`/price-alert ${subcommand}\` nu este recunoscuta.`);
    } catch (err: unknown) {
      deps.logger("WARN", "PRICE_ALERT_COMMAND", "Nu am putut modifica alertele de pret", errorDetail(err));
      return safeEdit(interaction, formatUserError(err, "Eroare la modificarea alertelor de pret."));
    }
  }

  return { handlePriceAlertInteraction };
}

function isPriceAlertCommand(interaction: DiscordInteraction): boolean {
  return interaction?.isChatInputCommand?.() === true
    && Boolean(interaction.guild)
    && interaction.commandName === "price-alert";
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
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

const installPriceAlertInteractionHandler = ((target: PriceAlertContext): void => {
  const previousHandleInteraction = target.handleInteraction;
  const { handlers, canHandle, handle } = buildPriceAlertCommandHandler(target);
  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!canHandle(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    return handle(interaction, games);
  }
  Object.assign(target, handlers, { handleInteraction });
}) as ((target: PriceAlertContext) => void) & {
  createPriceAlertInteractionHandler: typeof createPriceAlertInteractionHandler;
  buildPriceAlertRule: typeof buildPriceAlertRule;
  buildPriceAlertUpsertPipeline: typeof buildPriceAlertUpsertPipeline;
  buildCommandHandler: typeof buildPriceAlertCommandHandler;
};

installPriceAlertInteractionHandler.createPriceAlertInteractionHandler = createPriceAlertInteractionHandler;
installPriceAlertInteractionHandler.buildPriceAlertRule = buildPriceAlertRule;
installPriceAlertInteractionHandler.buildPriceAlertUpsertPipeline = buildPriceAlertUpsertPipeline;
installPriceAlertInteractionHandler.buildCommandHandler = buildPriceAlertCommandHandler;

export = installPriceAlertInteractionHandler;
