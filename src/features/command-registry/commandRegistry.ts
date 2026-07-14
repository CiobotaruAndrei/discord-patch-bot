import type { CommandCacheSizes, GameConfig, FetchResult, DealInfo, GuildSettings } from "../../types.js";
import type { NotificationDiscordClient, OutboxDiscordClient } from "../notifications/outboundChannel.js";
import type { CommandHandler, CommandGame, RoutedDiscordInteraction } from "./commandHandler.js";
import {
  dealPassesFilters,
  mapToObject,
  normalizePendingDiscountArray,
  normalizePendingUpdateArray,
  rotateAfter,
  toEntries
} from "../../domain/deals/filtersCore.js";

type MaybePromise<T> = T | Promise<T>;
type GuildGameFilter = Pick<GuildSettings, "enabledGames">;

interface CommandRegistryContext {
  cleanCache?: () => void;
  getCacheSizes?: () => CommandCacheSizes;
  setGlobalCacheTtl?: (ms: number) => void;
  setUpdatesCache?: (data: FetchResult[] | null) => void;
  setDealsCache?: (currency: unknown, data: DealInfo[]) => void;
  checkForUpdates?: (client: NotificationDiscordClient, games: GameConfig[], shouldAbort?: (() => boolean) | null) => Promise<void>;
  checkForDiscounts?: (client: NotificationDiscordClient, shouldAbort?: (() => boolean) | null) => Promise<void>;
  checkForYouTube?: (client: NotificationDiscordClient, shouldAbort?: (() => boolean) | null) => Promise<void>;
  refreshPlayerCountSnapshots?: (games: GameConfig[], shouldAbort?: (() => boolean) | null, client?: NotificationDiscordClient | null) => Promise<{ refreshed: number; failed: number; milestones: number }>;
  drainOutbox?: (client: OutboxDiscordClient) => MaybePromise<unknown>;
  buildOptimizedGameList?: <G extends { key: string }>(allGames: G[], subscribedGuilds: readonly GuildGameFilter[]) => G[];
  registerSlashCommands?: (token: string, clientId: string) => Promise<unknown>;
  buildSlashCommandDefinitions?: () => unknown[];
  handleInteraction?: (interaction: RoutedDiscordInteraction, games: CommandGame[]) => Promise<unknown>;
  buildHelpEmbed?: () => unknown;
  findGameAndSuggestion?: (input: string, games: GameConfig[]) => unknown;
  getFindGameCacheSize?: () => number;
  clearFindGameCache?: () => void;
  formatUserError?: (err: unknown, fallback: string, code?: string) => string;
  canSendEmbeds?: (channel: unknown, botId: string) => boolean;
}

type RequiredCommandRegistryKey =
  | "cleanCache"
  | "getCacheSizes"
  | "setGlobalCacheTtl"
  | "setUpdatesCache"
  | "setDealsCache"
  | "checkForUpdates"
  | "checkForDiscounts"
  | "checkForYouTube"
  | "refreshPlayerCountSnapshots"
  | "drainOutbox"
  | "buildOptimizedGameList"
  | "registerSlashCommands"
  | "buildSlashCommandDefinitions"
  | "handleInteraction"
  | "buildHelpEmbed"
  | "findGameAndSuggestion"
  | "getFindGameCacheSize"
  | "clearFindGameCache"
  | "formatUserError"
  | "canSendEmbeds";

type RequiredCommandRegistry = {
  [K in RequiredCommandRegistryKey]: NonNullable<CommandRegistryContext[K]>;
};

import attachCommandCache from "../command-cache/commandCache.js";
import attachDealFilters from "../../domain/deals/filters.js";
import attachCommandPresentation from "../command-presentation/commandPresentation.js";
import attachNotifications from "../notifications/index.js";
import attachPlayerCountSnapshots from "../player-count/playerCountSnapshotService.js";
import attachCachedSteamPlayerCount from "../player-count/cachedSteamPlayerCount.js";
import playerCountCache from "../../infra/redis/redisCacheContext.js";
import attachFeedbackRepository from "../feedback/feedbackRepository.js";
import { createReportRepository } from "../feedback/reportRepository.js";
import { mergeGuildGameAliases } from "../guild-config/gameAliasService.js";
import attachSlashCommandDefinitions from "../command-definitions/slashCommandDefinitions.js";
import attachHelpInteractionHandler from "../command-handlers/helpInteractionHandler.js";
import attachCommandSnoozeGuard from "../command-security/commandSnoozeGuard.js";
import attachAdminCommandRouterGuard from "../command-security/adminCommandRouterGuard.js";
import { createCommandHandlerDescriptors } from "./commandHandlerDescriptors.js";

import commandRuntimeContext from "../command-runtime/commandRuntimeContext.js";
const { createCommandRuntimeContext } = commandRuntimeContext;
type CommandRuntimeBootContext = ReturnType<typeof createCommandRuntimeContext>;

const PLAYER_COUNT_CACHE_TTL_SECONDS = 60;

function createAppServices(
  overrides: Partial<CommandRuntimeBootContext> = {}
) {
  const runtime = { ...createCommandRuntimeContext(), ...overrides };
  const cache = { ...runtime, ...attachCommandCache.createCommandCache(runtime) };
  const filters = {
    ...cache,
    dealPassesFilters, normalizePendingUpdateArray, normalizePendingDiscountArray, toEntries, mapToObject, rotateAfter
  };
  const presentation = { ...filters, ...attachCommandPresentation.createCommandPresentation(filters) };
  const notifications = { ...presentation, ...attachNotifications.createNotificationRuntime(presentation) };
  const cachedFetchSteamCurrentPlayers = attachCachedSteamPlayerCount.createCachedSteamPlayerCount({
    fetchSteamCurrentPlayers: notifications.fetchSteamCurrentPlayers,
    cache: playerCountCache,
    ttlSeconds: PLAYER_COUNT_CACHE_TTL_SECONDS
  });
  const playerCounts = {
    ...notifications,
    ...attachPlayerCountSnapshots.createPlayerCountSnapshotService({ ...notifications, fetchSteamCurrentPlayers: cachedFetchSteamCurrentPlayers })
  };
  const feedbackRepository = attachFeedbackRepository.createFeedbackRepository(playerCounts);
  const reportRepository = createReportRepository(playerCounts);
  const feedback = {
    ...playerCounts,
    recordFeedbackReport: feedbackRepository.recordReport,
    getRecentFeedbackReports: feedbackRepository.getRecent,
    resolveFeedbackReport: feedbackRepository.resolveReport,
    ...reportRepository
  };
  return { ...feedback, ...attachSlashCommandDefinitions.createSlashCommandDefinitions(feedback) };
}

export type CommandAppServices = ReturnType<typeof createAppServices>;

function buildCommandHandlerList(ctx: ReturnType<typeof createAppServices>): { commandHandlers: CommandHandler[]; helpCommand: ReturnType<typeof attachHelpInteractionHandler.buildCommandHandler> } {
  const helpCommand = attachHelpInteractionHandler.buildCommandHandler(ctx);
  const descriptors = createCommandHandlerDescriptors();
  const commandHandlers: CommandHandler[] = descriptors.map(descriptor => descriptor.build(ctx));
  commandHandlers.splice(commandHandlers.length - 2, 0, helpCommand);
  return { commandHandlers, helpCommand };
}

function createCommandRegistry(
  overrides: Partial<CommandRuntimeBootContext> = {}
): RequiredCommandRegistry {
  const ctx = createAppServices(overrides);
  const { commandHandlers, helpCommand } = buildCommandHandlerList(ctx);

  async function dispatchCommand(interaction: RoutedDiscordInteraction, games: CommandGame[]): Promise<unknown> {
    let resolvedGames = games;
    const guildId = interaction.guild?.id;
    if (typeof guildId === "string") {
      const settings = await ctx.getGuildSettings(guildId).catch(() => null);
      resolvedGames = mergeGuildGameAliases(games as GameConfig[], settings);
    }
    for (const handler of commandHandlers) {
      if (handler.canHandle(interaction)) return handler.handle(interaction, resolvedGames);
    }
    return undefined;
  }

  const snoozeGuard = attachCommandSnoozeGuard.createCommandSnoozeGuard({
    getGuildSettings: ctx.getGuildSettings,
    MessageFlags: ctx.MessageFlags,
    logger: ctx.logger
  });
  const adminGuard = attachAdminCommandRouterGuard.createAdminCommandGuard({
    requireGuildAdmin: interaction => attachAdminCommandRouterGuard.requireGuildAdminWithConfiguredAccess(ctx, interaction),
    authorizeGuildAdmin: interaction => attachAdminCommandRouterGuard.authorizeGuildAdminWithConfiguredAccess(ctx, interaction)
  }, ctx);

  async function dispatchWithSnoozeGuard(interaction: RoutedDiscordInteraction, games: CommandGame[]): Promise<unknown> {
    return snoozeGuard.handleSnoozedCommand(interaction, games, dispatchCommand);
  }

  async function handleInteraction(interaction: RoutedDiscordInteraction, games: CommandGame[]): Promise<unknown> {
    if (attachAdminCommandRouterGuard.isAdminProtectedCommand(interaction)) {
      return adminGuard.handleAdminProtectedCommand(interaction, games, dispatchWithSnoozeGuard);
    }
    return dispatchWithSnoozeGuard(interaction, games);
  }

  return Object.freeze({
    cleanCache: ctx.cleanCache,
    getCacheSizes: ctx.getCacheSizes,
    setGlobalCacheTtl: ctx.setGlobalCacheTtl,
    setUpdatesCache: ctx.setUpdatesCache,
    setDealsCache: ctx.setDealsCache,
    checkForUpdates: ctx.checkForUpdates,
    checkForDiscounts: ctx.checkForDiscounts,
    checkForYouTube: ctx.checkForYouTube,
    refreshPlayerCountSnapshots: ctx.refreshPlayerCountSnapshots,
    drainOutbox: ctx.drainOutbox,
    buildOptimizedGameList: ctx.buildOptimizedGameList,
    registerSlashCommands: ctx.registerSlashCommands,
    buildSlashCommandDefinitions: ctx.buildSlashCommandDefinitions,
    handleInteraction,
    buildHelpEmbed: helpCommand.buildHelpEmbed,
    findGameAndSuggestion: ctx.findGameAndSuggestion,
    getFindGameCacheSize: ctx.getFindGameCacheSize,
    clearFindGameCache: ctx.clearFindGameCache,
    formatUserError: ctx.formatUserError,
    canSendEmbeds: ctx.canSendEmbeds
  });
}

const commands = Object.freeze({ ...createCommandRegistry(), createCommandRegistry, createAppServices, buildCommandHandlerList });

export default commands;
