import { load as cheerioLoad } from "cheerio";
import type { NotificationDiscordClient, OutboxDiscordClient } from "../features/notifications/outboundChannel.js";
import type { DealInfo, NormalizedUpdate } from "../sources/sourceTypes.js";
import type { GuildDoc } from "../infra/mongo/modelTypes.js";
import type { SourceRegistryApi } from "../sources/sourceRegistry.js";

export function makeNotificationDiscordClient(overrides: Partial<NotificationDiscordClient> = {}): NotificationDiscordClient {
  return {
    user: { id: "bot-1" },
    channels: { fetch: async () => null },
    ...overrides
  };
}

export function makeOutboxDiscordClient(overrides: Partial<OutboxDiscordClient> = {}): OutboxDiscordClient {
  return {
    isReady: () => true,
    ...makeNotificationDiscordClient(),
    ...overrides
  };
}

export function makeDealInfo(overrides: Partial<DealInfo> = {}): DealInfo {
  return {
    id: "deal-1",
    title: "Snap Deal",
    store: "Steam",
    link: "https://example.com/deal",
    salePrice: "10.00",
    normalPrice: "20.00",
    savings: 50,
    ...overrides
  };
}

export function makeGuildDoc(overrides: Partial<GuildDoc> = {}): GuildDoc {
  return {
    _id: "guild-1",
    subscribed: true,
    notificationChannelId: "channel-1",
    discountsSubscribed: false,
    discountChannelId: null,
    enabledGames: [],
    ...overrides
  };
}

export interface DiscordInteractionStub {
  commandName: string;
  deferred: boolean;
  replied: boolean;
  guild: { id: string } | null;
  client: OutboxDiscordClient;
  isChatInputCommand: () => boolean;
  reply: (payload: unknown) => Promise<unknown>;
  followUp: (payload: unknown) => Promise<unknown>;
  editReply: (payload: unknown) => Promise<unknown>;
  deferReply: (opts?: unknown) => Promise<unknown>;
  replies: unknown[];
}

export function makeDiscordInteraction(overrides: Partial<Omit<DiscordInteractionStub, "replies">> = {}): DiscordInteractionStub {
  const replies: unknown[] = [];
  const capture = async (payload: unknown) => { replies.push(payload); return { id: "reply" }; };
  return {
    commandName: "ping",
    deferred: false,
    replied: false,
    guild: { id: "guild-1" },
    client: makeOutboxDiscordClient(),
    isChatInputCommand: () => true,
    reply: capture,
    followUp: capture,
    editReply: capture,
    deferReply: async () => undefined,
    replies,
    ...overrides
  };
}

export function makeSourceRegistryApi(overrides: Partial<SourceRegistryApi> = {}): SourceRegistryApi {
  const emptyUpdate: NormalizedUpdate = {
    id: "u-1",
    title: "",
    link: "",
    excerpt: "",
    fullText: "",
    image: null,
    thumbnail: null,
    timestamp: ""
  };
  return {
    USER_AGENTS: ["test-agent"],
    MAX_HTML_BYTES: 1024,
    MAX_JSON_BYTES: 2048,
    MAX_DEALS: 3,
    FETCH_CONCURRENCY: 2,
    cleanText: value => String(value ?? "").trim(),
    truncate: (value, maxLen) => String(value ?? "").slice(0, maxLen),
    normalizeTitleForDedupe: value => String(value ?? "").toLowerCase(),
    stableUpdateId: () => "stable-id",
    normalizeUpdate: data => ({ id: "u-1", title: "", link: "", excerpt: "", thumbnail: null, image: null, timestamp: "", ...(data as Record<string, unknown>) }) as ReturnType<SourceRegistryApi["normalizeUpdate"]>,
    safeCheerioLoad: html => cheerioLoad(typeof html === "string" ? html : ""),
    levenshtein: () => 0,
    httpReq: async () => ({ data: "" }),
    fetchWithProxy: async () => "",
    dealHash: deal => String((deal as { id?: unknown }).id ?? "hash"),
    attachMetrics: () => undefined,
    fetchGameUpdate: async () => emptyUpdate,
    executeFetchWithCircuitBreaker: async game => ({ game, latest: null, error: null }),
    getLatestForAllGames: async () => [],
    fetchSteamReviewData: async () => ({ totalReviews: 0, qualityPercent: 0, success: false }),
    enrichDealData: async deal => deal,
    fetchDeals: async () => [],
    searchSteamGameByName: async () => [],
    chooseBestSteamMatch: () => null,
    fetchSteamPriceDetails: async () => null,
    fetchSteamCurrentPlayers: async appId => ({ appId: String(appId), playerCount: 0, success: false }),
    fetchSteamLatestUpdateSize: async () => ({ size: null, title: null, publishedAt: null, sourceUrl: null }),
    extractOfferEndFromHtml: () => null,
    extractSteamOfferEndDate: async () => null,
    cleanEnrichedCache: () => undefined,
    getEnrichedCacheSize: () => 0,
    formatPrice: value => `$${String(value ?? 0)}`,
    ...overrides
  };
}
