export type GameType =
  | "steam"
  | "minecraft"
  | "epic_games"
  | "roblox"
  | "listing_based"
  | "nvidia"
  | "amd"
  | "intel"
  | "rss";

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
  [key: string]: unknown;
}

export interface BotConfig {
  checkIntervalMinutes?: number;
  games: GameConfig[];
}

export interface ConfigLoadResult {
  config: BotConfig;
  games: GameConfig[];
  configPath: string;
}
