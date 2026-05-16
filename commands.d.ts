import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Interaction
} from "discord.js";
import type { AbortPredicate, CommandCacheSizes, GameConfig } from "./types";

type CommandInteraction = ChatInputCommandInteraction | AutocompleteInteraction | Interaction;

export function startCacheCleaner(): NodeJS.Timeout;
export function cleanCache(): void;
export function getCacheSizes(): CommandCacheSizes;
export function setGlobalCacheTtl(ms: number): void;

export function checkForUpdates(
  client: Client,
  games: GameConfig[],
  shouldAbort?: AbortPredicate | null
): Promise<void>;

export function checkForDiscounts(
  client: Client,
  shouldAbort?: AbortPredicate | null
): Promise<void>;

export function registerSlashCommands(token: string, clientId: string): Promise<void>;
export function buildSlashCommandDefinitions(): unknown[];

export function handleInteraction(
  interaction: CommandInteraction,
  games: GameConfig[]
): Promise<unknown> | unknown;

export function buildHelpEmbed(): EmbedBuilder;
export function formatUserError(
  err: unknown,
  defaultMsg?: string,
  errorCode?: string | null
): string;
