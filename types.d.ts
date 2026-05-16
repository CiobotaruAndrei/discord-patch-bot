export type GameType =
  | "steam"
  | "minecraft"
  | "epic_games"
  | "roblox"
  | "listing_based"
  | "nvidia"
  | "amd"
  | "intel";

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
  [key: string]: unknown;
}

export interface BotConfig {
  checkIntervalMinutes?: number;
  games: GameConfig[];
}

export interface PatchUpdate {
  id?: string;
  title?: string;
  url?: string;
  link?: string;
  summary?: string;
  content?: string;
  publishedAt?: string | Date;
  date?: string | Date;
  author?: string;
  image?: string;
  [key: string]: unknown;
}

export interface DealInfo {
  id?: string;
  title?: string;
  url?: string;
  store?: string;
  appId?: string;
  normalPrice?: string | number;
  salePrice?: string | number;
  discountPercent?: number;
  currency?: string;
  image?: string;
  endsAt?: string | Date | null;
  [key: string]: unknown;
}
