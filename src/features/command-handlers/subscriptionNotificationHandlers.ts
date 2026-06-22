"use strict";

import type { DealInfo, FetchResult, GameConfig, GuildSettings } from "../../types";
import type { CommandHandler } from "../command-registry/commandHandler";

const { errorDetail, errorMessage } = require("../../shared/errors");
const { HASH_VERSION } = require("../../native/fuzzy") as { HASH_VERSION: number };

type MaybePromise<T> = T | Promise<T>;

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type MongoWriteResult = { matchedCount?: number; modifiedCount?: number };
type InteractionPayload = string | Record<string, unknown>;

interface DiscordChannel {
  id: string;
}

interface DiscordInteraction {
  commandName?: string;
  guild?: { id: string } | null;
  channel?: DiscordChannel | null;
  client?: { user?: { id: string } | null } | null;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getSubcommand(): string;
  };
  isChatInputCommand?: () => boolean;
  reply?: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
}

type GuildModelLike = {
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<MongoWriteResult>;
};

type SubscriptionInteractionDeps = {
  GuildModel: GuildModelLike;
  logger: Logger;
  getGuildSettings: (guildId: string) => Promise<GuildSettings | null>;
  invalidateGuildCache: (guildId: string) => void;
  DEFAULT_CURRENCY: string;
  getLatestForAllGames: (games: GameConfig[]) => Promise<FetchResult[]>;
  fetchDeals: (options: { currency: string }) => Promise<DealInfo[]>;
  dealHash: (deal: DealInfo) => string;
  seedSeenUpdates: (guildId: string, entries: Array<{ gameKey: string; updateId: string }>) => Promise<void>;
  seedSeenDiscounts: (guildId: string, hashes: string[]) => Promise<void>;
  DEALS_HISTORY_LIMIT: number;
  OP_UPDATE_OPTS: Record<string, unknown>;
  setDealsCache: (currency: string, deals: DealInfo[]) => void;
  safeDefer: (interaction: DiscordInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, payload: InteractionPayload) => Promise<unknown>;
  canSendEmbeds: (channel: DiscordChannel | null | undefined, botId: string) => boolean;
  listMissingChannelPerms: (channel: DiscordChannel | null | undefined, botId: string) => string[] | null;
  missingChannelPermsMessage: (missing?: string[] | null) => string;
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
    getLatestForAllGames, fetchDeals, dealHash, seedSeenUpdates, seedSeenDiscounts, DEALS_HISTORY_LIMIT,
    OP_UPDATE_OPTS, setDealsCache, safeDefer, safeEdit, canSendEmbeds, listMissingChannelPerms,
    missingChannelPermsMessage, makeActivationId, formatUserError
  } = deps;

  async function handleStartInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    await safeDefer(interaction);

    const botId = interaction.client?.user?.id;
    if (!botId || !canSendEmbeds(interaction.channel, botId)) {
      return safeEdit(interaction, missingChannelPermsMessage(botId ? listMissingChannelPerms(interaction.channel, botId) : null));
    }
    if (!interaction.channel) {
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
          const seedEntries = results
            .filter(result => result.latest)
            .map(result => ({ gameKey: result.game.key, updateId: result.latest!.id }));
          await seedSeenUpdates(guildId, seedEntries);
          const activationResult = await GuildModel.updateOne(
            {
              _id: guildId,
              subscribed: true,
              notificationChannelId: interaction.channel.id,
              updatesActivationId: activationId
            },
            {
              $set: { updatesInitializing: false, seenHashVersionUpdates: HASH_VERSION },
              $unset: { updatesActivationId: "", updatesLastError: "" }
            },
            OP_UPDATE_OPTS
          );
          if (activationResult.matchedCount === 0) {
            return safeEdit(interaction, "Activarea update-urilor a fost intrerupta de o comanda stop/start mai noua. Ruleaza din nou /start updates daca mai vrei activarea.");
          }
          return safeEdit(interaction, "OK: Update-uri automate activate.");
        } catch (err: unknown) {
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
      } catch (err: unknown) {
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
          const initHashes = deals.slice(0, DEALS_HISTORY_LIMIT).map((deal) => dealHash(deal));
          await seedSeenDiscounts(guildId, initHashes);
          const activationResult = await GuildModel.updateOne(
            {
              _id: guildId,
              discountsSubscribed: true,
              discountChannelId: interaction.channel.id,
              discountsActivationId: activationId
            },
            {
              $set: {
                discountsInitializing: false,
                seenHashVersionDiscounts: HASH_VERSION
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
        } catch (err: unknown) {
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
      } catch (err: unknown) {
        return safeEdit(interaction, formatUserError(err, "Eroare la activarea reducerilor."));
      }
    }

    logger?.("WARN", "START_COMMAND", `Subcomanda /start necunoscuta: ${sub}`);
    return safeEdit(interaction, `Eroare: Subcomanda \`/start ${sub}\` nu este recunoscuta.`);
  }

  async function handleStopInteraction(interaction: DiscordInteraction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
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
    } catch (err: unknown) {
      return safeEdit(interaction, formatUserError(err, "Eroare la baza de date."));
    }

    logger?.("WARN", "STOP_COMMAND", `Subcomanda /stop necunoscuta: ${sub}`);
    return safeEdit(interaction, `Eroare: Subcomanda \`/stop ${sub}\` nu este recunoscuta.`);
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

function buildSubscriptionCommandHandler(target: SubscriptionContext) {
  const handlers = createSubscriptionInteractionHandlers({
    GuildModel: target.GuildModel,
    logger: target.logger,
    getGuildSettings: target.getGuildSettings,
    invalidateGuildCache: target.invalidateGuildCache,
    DEFAULT_CURRENCY: target.DEFAULT_CURRENCY,
    getLatestForAllGames: target.getLatestForAllGames,
    fetchDeals: target.fetchDeals,
    dealHash: target.dealHash,
    seedSeenUpdates: target.seedSeenUpdates,
    seedSeenDiscounts: target.seedSeenDiscounts,
    DEALS_HISTORY_LIMIT: target.DEALS_HISTORY_LIMIT,
    OP_UPDATE_OPTS: target.OP_UPDATE_OPTS,
    setDealsCache: target.setDealsCache,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    canSendEmbeds: target.canSendEmbeds,
    listMissingChannelPerms: target.listMissingChannelPerms,
    missingChannelPermsMessage: target.missingChannelPermsMessage,
    makeActivationId: target.makeActivationId,
    formatUserError: target.formatUserError
  });

  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => Boolean(isSubscriptionCommand(interaction as DiscordInteraction)),
    handle: async (interaction, games) => {
      const di = interaction;
      try {
        if (di.commandName === "start") return await handlers.handleStartInteraction(di, games as GameConfig[]);
        return await handlers.handleStopInteraction(di);
      } catch (err: unknown) {
        target.logger?.("ERROR", "SUBSCRIPTION_INTERACTION", "Eroare in handler-ul de start/stop", errorDetail(err));
        const payload = createInteractionErrorPayload(target.MessageFlags);
        try {
          if ((di.deferred || di.replied) && typeof di.followUp === "function") await di.followUp(payload);
          else if (typeof di.reply === "function") await di.reply(payload);
        } catch {  }
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

function installSubscriptionInteractions(target: SubscriptionContext) {
  const previousHandleInteraction = target.handleInteraction;
  const { handlers, canHandle, handle } = buildSubscriptionCommandHandler(target);

  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!canHandle(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    return handle(interaction, games);
  }

  Object.assign(target, handlers, { handleInteraction });
}

export = Object.assign(installSubscriptionInteractions, { createSubscriptionInteractionHandlers, buildCommandHandler: buildSubscriptionCommandHandler });
