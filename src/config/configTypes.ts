import type { NormalizedGameConfig, NormalizedGameSourceFallback } from "./gameConfigSchemas.js";
import type { GameCatalog } from "./gameCatalog.js";

export type GameType = NormalizedGameConfig["type"];

export interface GameSourceFallback {
  type: GameType;
  url?: string;
  listingUrl?: string;
  listingUrls?: string[];
  baseUrl?: string;
}

export interface GameConfig {
  key: string;
  name: string;
  type?: GameType;
  appId?: string;
  listingUrl?: string;
  listingUrls?: string[];
  baseUrl?: string;
  articleHrefRegex?: string;
  requireKeywords?: string[];
  thumbnail?: string;
  url?: string;
  aliases?: string[];
  upCRD?: 0 | 1;
  fallbacks?: GameSourceFallback[];
}

export interface BotConfig {
  checkIntervalMinutes?: number;
  games: NormalizedGameConfig[];
}

export interface ConfigLoadResult {
  config: BotConfig;
  games: NormalizedGameConfig[];
  catalog: GameCatalog;
  configPath: string;
}

export type { NormalizedGameConfig, NormalizedGameSourceFallback } from "./gameConfigSchemas.js";
export type { GameCatalog } from "./gameCatalog.js";
