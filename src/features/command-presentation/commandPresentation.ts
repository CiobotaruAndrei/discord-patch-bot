import type { ActionRowComponent, ButtonComponent, ChainableEmbed, PresentationLogger } from "./presentationContracts";
import { createInteractionReplyHelpers } from "./interactionReplyHelpers";
import { createNotificationEmbeds } from "./notificationEmbeds";
import { createPaginationControls } from "./paginationControls";
import { createGameLookupCache } from "./gameLookupCache";
import { createGameStatusEmbeds } from "./gameStatusEmbeds";

interface HttpResponse<T = unknown> {
  data: T;
}

type CommandUiDeps = {
  crypto: {
    randomBytes(size: number): { toString(encoding: BufferEncoding): string };
  };
  EmbedBuilder: new () => ChainableEmbed;
  ActionRowBuilder: new () => ActionRowComponent;
  ButtonBuilder: new () => ButtonComponent;
  ButtonStyle: { Primary: unknown; Secondary: unknown };
  ComponentType: { Button: unknown };
  MessageFlags: { Ephemeral: number };
  logger: PresentationLogger;
  checkUserCooldown(userId: unknown, command: string): { allowed: boolean; remainingMs?: number };
  COLORS: Record<string, number>;
  truncate(value: unknown, maxLen: number): string;
  DEFAULT_CURRENCY: string;
  formatPrice(value: unknown, currencyCode?: string): string;
  COLLECTOR_TIMEOUT_MS: number;
  MAX_FUZZY_SEARCH_INPUT: number;
  httpReq(method: string, url: string, options?: Record<string, unknown>): Promise<HttpResponse>;
};

function createCommandPresentation(deps: CommandUiDeps) {
  const {
    crypto, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ComponentType, MessageFlags, logger, checkUserCooldown, COLORS,
    truncate, DEFAULT_CURRENCY, formatPrice, COLLECTOR_TIMEOUT_MS,
    MAX_FUZZY_SEARCH_INPUT, httpReq
  } = deps;

  const replyHelpers = createInteractionReplyHelpers({ logger, checkUserCooldown, MessageFlags });
  const notificationEmbeds = createNotificationEmbeds({ EmbedBuilder, COLORS, truncate, DEFAULT_CURRENCY, formatPrice });
  const pagination = createPaginationControls({ crypto, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags, COLLECTOR_TIMEOUT_MS, logger });
  const gameLookup = createGameLookupCache({ MAX_FUZZY_SEARCH_INPUT });
  const statusEmbeds = createGameStatusEmbeds({ EmbedBuilder, COLORS, logger, httpReq, DEFAULT_CURRENCY, formatPrice });

  return {
    enforceCooldown: replyHelpers.enforceCooldown,
    startCommandLog: replyHelpers.startCommandLog,
    safeDefer: replyHelpers.safeDefer,
    safeEdit: replyHelpers.safeEdit,
    buildUpdateEmbed: notificationEmbeds.buildUpdateEmbed,
    buildDealEmbed: notificationEmbeds.buildDealEmbed,
    generateSessionId: pagination.generateSessionId,
    buildPaginationButtons: pagination.buildPaginationButtons,
    handlePagination: pagination.handlePagination,
    findGameAndSuggestion: gameLookup.findGameAndSuggestion,
    getFindGameCacheSize: gameLookup.getFindGameCacheSize,
    clearFindGameCache: gameLookup.clearFindGameCache,
    fetchGameStatus: statusEmbeds.fetchGameStatus,
    buildSteamPriceEmbed: statusEmbeds.buildSteamPriceEmbed
  };
}

type CommandUiRuntime = ReturnType<typeof createCommandPresentation>;
type CommandUiContext = CommandUiDeps & Partial<CommandUiRuntime>;

type CommandUiInstaller = ((target: CommandUiContext) => void) & {
  createCommandPresentation: typeof createCommandPresentation;
};

const attachCommandUi = ((target: CommandUiContext): void => {
  const deps: CommandUiDeps = {
    crypto: target.crypto,
    EmbedBuilder: target.EmbedBuilder,
    ActionRowBuilder: target.ActionRowBuilder,
    ButtonBuilder: target.ButtonBuilder,
    ButtonStyle: target.ButtonStyle,
    ComponentType: target.ComponentType,
    MessageFlags: target.MessageFlags,
    logger: target.logger,
    checkUserCooldown: target.checkUserCooldown,
    COLORS: target.COLORS,
    truncate: target.truncate,
    DEFAULT_CURRENCY: target.DEFAULT_CURRENCY,
    formatPrice: target.formatPrice,
    COLLECTOR_TIMEOUT_MS: target.COLLECTOR_TIMEOUT_MS,
    MAX_FUZZY_SEARCH_INPUT: target.MAX_FUZZY_SEARCH_INPUT,
    httpReq: target.httpReq
  };
  Object.assign(target, createCommandPresentation(deps));
}) as CommandUiInstaller;

attachCommandUi.createCommandPresentation = createCommandPresentation;

export = attachCommandUi;
