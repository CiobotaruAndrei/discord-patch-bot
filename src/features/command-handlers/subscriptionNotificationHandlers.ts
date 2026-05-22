"use strict";

const { errorDetail, errorMessage } = require("../../shared/errors");

type DiscordInteraction = any;
type GameConfig = any;
type MaybePromise<T> = T | Promise<T>;

type GuildModelLike = {
  updateOne: (...args: any[]) => Promise<any>;
};

type SubscriptionInteractionDeps = {
  GuildModel: GuildModelLike;
  logger: (...args: any[]) => void;
  getGuildSettings: (guildId: string) => Promise<any>;
  invalidateGuildCache: (guildId: string) => void;
  DEFAULT_CURRENCY: string;
  getLatestForAllGames: (games: GameConfig[]) => Promise<any[]>;
  fetchDeals: (options: { currency: string }) => Promise<any[]>;
  dealHash: (deal: any) => string;
  DEALS_HISTORY_LIMIT: number;
  OP_UPDATE_OPTS: Record<string, any>;
  setDealsCache: (currency: string, deals: any[]) => void;
  safeDefer: (interaction: DiscordInteraction) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, payload: any) => Promise<any>;
  canSendEmbeds: (channel: any, botId: string) => boolean;
  missingChannelPermsMessage: () => string;
  makeActivationId: () => string;
  formatUserError: (err: unknown, fallback: string) => string;
};

type SubscriptionContext = SubscriptionInteractionDeps & {
  MessageFlags: { Ephemeral: number };
  handleInteraction?: (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;
};

function createSubscriptionInteractionHandlers(deps: SubscriptionInteractionDeps) {
  const {
    GuildModel, logger, getGuildSettings, invalidateGuildCache, DEFAULT_CURRENCY,
    getLatestForAllGames, fetchDeals, dealHash, DEALS_HISTORY_LIMIT,
    OP_UPDATE_OPTS, setDealsCache, safeDefer, safeEdit, canSendEmbeds,
    missingChannelPermsMessage, makeActivationId, formatUserError
  } = deps;

  async function handleStartInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    await safeDefer(interaction);

    if (!canSendEmbeds(interaction.channel, interaction.client.user.id)) {
      return safeEdit(interaction, missingChannelPermsMessage());
    }

    if (sub === "updates") {
      try {
        const activationId = makeActivationId();
        await GuildModel.updateOne(
          { _id: guildId },
          {
            $set: {
              subscribed: true,
              notificationChannelId: interaction.channel.id,
              updatesInitializing: true,
              updatesActivationId: activationId,
              pendingUpdates: {}
            },
            $unset: { updatesLastError: "" }
          },
          { upsert: true, ...OP_UPDATE_OPTS }
        );
        invalidateGuildCache(guildId);

        try {
          const results = await getLatestForAllGames(games);
          const seenPayload: Record<string, any> = {
            updatesInitializing: false
          };
          for (const result of results) {
            if (result.latest) seenPayload[`seen.${result.game.key}`] = [result.latest.id];
          }
          const activationResult = await GuildModel.updateOne(
            {
              _id: guildId,
              subscribed: true,
              notificationChannelId: interaction.channel.id,
              updatesActivationId: activationId
            },
            {
              $set: seenPayload,
              $unset: { updatesActivationId: "", updatesLastError: "" }
            },
            OP_UPDATE_OPTS
          );
          if (activationResult.matchedCount === 0) {
            return safeEdit(interaction, "Activarea update-urilor a fost intrerupta de o comanda stop/start mai noua. Ruleaza din nou /start updates daca mai vrei activarea.");
          }
          return safeEdit(interaction, "OK: Update-uri automate activate.");
        } catch (err: any) {
          await GuildModel.updateOne(
            { _id: guildId, updatesActivationId: activationId },
            {
              $set: {
                subscribed: false,
                notificationChannelId: null,
                updatesInitializing: false,
                updatesLastError: { message: errorMessage(err), channelId: interaction.channel.id, at: new Date() }
              },
              $unset: { updatesActivationId: "" }
            },
            OP_UPDATE_OPTS
          ).catch(() => null);
          logger("WARN", "START_UPDATES", "Activat, dar baseline-ul initial a esuat", errorMessage(err));
          invalidateGuildCache(guildId);
          return safeEdit(interaction, formatUserError(err, "Nu am activat update-urile fiindca baseline-ul initial nu a putut fi incarcat."));
        }
      } catch (err: any) {
        return safeEdit(interaction, formatUserError(err, "Eroare la activarea update-urilor."));
      }
    }

    if (sub === "reduceri") {
      try {
        const activationId = makeActivationId();
        const existingGuild = await getGuildSettings(guildId);
        const currency = existingGuild?.currency || DEFAULT_CURRENCY;
        await GuildModel.updateOne(
          { _id: guildId },
          {
            $set: {
              discountsSubscribed: true,
              discountChannelId: interaction.channel.id,
              discountsInitializing: true,
              discountsActivationId: activationId,
              pendingDiscounts: []
            },
            $unset: { discountsLastError: "" }
          },
          { upsert: true, ...OP_UPDATE_OPTS }
        );
        invalidateGuildCache(guildId);

        try {
          const deals = await fetchDeals({ currency });
          const initHashes = deals.slice(0, DEALS_HISTORY_LIMIT).map((deal: any) => dealHash(deal));
          const activationResult = await GuildModel.updateOne(
            {
              _id: guildId,
              discountsSubscribed: true,
              discountChannelId: interaction.channel.id,
              discountsActivationId: activationId
            },
            {
              $set: {
                seenDiscounts: initHashes,
                discountsInitializing: false
              },
              $unset: { discountsActivationId: "", discountsLastError: "" }
            },
            OP_UPDATE_OPTS
          );
          if (activationResult.matchedCount === 0) {
            return safeEdit(interaction, "Activarea reducerilor a fost intrerupta de o comanda stop/start mai noua. Ruleaza din nou /start reduceri daca mai vrei activarea.");
          }
          setDealsCache(currency, deals);
          return safeEdit(interaction, `OK: Alerte reduceri activate pe acest canal. Valuta: **${currency}**.`);
        } catch (err: any) {
          await GuildModel.updateOne(
            { _id: guildId, discountsActivationId: activationId },
            {
              $set: {
                discountsSubscribed: false,
                discountChannelId: null,
                discountsInitializing: false,
                discountsLastError: { message: errorMessage(err), channelId: interaction.channel.id, at: new Date() }
              },
              $unset: { discountsActivationId: "" }
            },
            OP_UPDATE_OPTS
          ).catch(() => null);
          logger("WARN", "START_DISCOUNTS", "Activat, dar baseline-ul de reduceri a esuat", errorMessage(err));
          invalidateGuildCache(guildId);
          return safeEdit(interaction, formatUserError(err, "Nu am activat reducerile fiindca baseline-ul initial nu a putut fi incarcat."));
        }
      } catch (err: any) {
        return safeEdit(interaction, formatUserError(err, "Eroare la activarea reducerilor."));
      }
    }
  }

  async function handleStopInteraction(interaction: DiscordInteraction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    await safeDefer(interaction);
    try {
      if (sub === "updates") {
        await GuildModel.updateOne({ _id: guildId }, {
          $set: { subscribed: false, notificationChannelId: null, updatesInitializing: false, pendingUpdates: {} },
          $unset: { updatesActivationId: "" }
        }, OP_UPDATE_OPTS);
        invalidateGuildCache(guildId);
        return safeEdit(interaction, "OK: Update-uri oprite.");
      }
      if (sub === "reduceri") {
        await GuildModel.updateOne({ _id: guildId }, {
          $set: { discountsSubscribed: false, discountChannelId: null, discountsInitializing: false, pendingDiscounts: [] },
          $unset: { discountsActivationId: "" }
        }, OP_UPDATE_OPTS);
        invalidateGuildCache(guildId);
        return safeEdit(interaction, "OK: Reduceri oprite.");
      }
    } catch (err: any) {
      return safeEdit(interaction, formatUserError(err, "Eroare la baza de date."));
    }
  }

  return { handleStartInteraction, handleStopInteraction };
}

function isSubscriptionCommand(interaction: DiscordInteraction) {
  return interaction?.isChatInputCommand?.() === true
    && interaction.guild
    && (interaction.commandName === "start" || interaction.commandName === "stop");
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }) {
  return {
    content: "Eroare: Eroare neasteptata la procesarea comenzii.",
    flags: MessageFlags.Ephemeral
  };
}

function installSubscriptionInteractions(ctx: SubscriptionContext) {
  const previousHandleInteraction = ctx.handleInteraction;
  const handlers = createSubscriptionInteractionHandlers(ctx);

  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!isSubscriptionCommand(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }

    try {
      if (interaction.commandName === "start") return handlers.handleStartInteraction(interaction, games);
      return handlers.handleStopInteraction(interaction);
    } catch (err: any) {
      ctx.logger("ERROR", "SUBSCRIPTION_INTERACTION", "Eroare in handler-ul de start/stop", errorDetail(err));
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

Object.assign(installSubscriptionInteractions, { createSubscriptionInteractionHandlers });

export = installSubscriptionInteractions;
