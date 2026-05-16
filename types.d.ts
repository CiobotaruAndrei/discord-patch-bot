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
  excerpt?: string;
  content?: string;
  fullText?: string;
  publishedAt?: string | Date;
  date?: string | Date;
  timestamp?: string | Date;
  author?: string;
  image?: string | null;
  thumbnail?: string | null;
  [key: string]: unknown;
}

export interface DealInfo {
  id?: string;
  title?: string;
  url?: string;
  link?: string;
  store?: string;
  appId?: string;
  steamAppID?: string | number | null;
  normalPrice?: string | number;
  salePrice?: string | number;
  savings?: string | number;
  discountPercent?: number;
  popularityScore?: number;
  totalReviews?: number;
  qualityScore?: number;
  currency?: string;
  image?: string | null;
  thumbnail?: string | null;
  endsAt?: string | Date | null;
  endDateStr?: string | null;
  extraDetails?: string;
  enriched?: boolean;
  [key: string]: unknown;
}
