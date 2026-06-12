import type { NotificationDiscordClient, OutboxDiscordClient } from "../features/notifications/outboundChannel";
import type { DealInfo } from "../types";
import type { GuildDoc } from "../infra/mongo/modelTypes";
import type { SourceRegistryApi } from "../sources/sourceRegistry";

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
    safeCheerioLoad: () => (() => undefined) as unknown as ReturnType<SourceRegistryApi["safeCheerioLoad"]>,
    levenshtein: () => 0,
    httpReq: async () => ({ data: "" }),
    fetchWithProxy: async () => "",
    dealHash: deal => String((deal as { id?: unknown }).id ?? "hash"),
    attachMetrics: () => undefined,
    fetchGameUpdate: (async () => null) as unknown as SourceRegistryApi["fetchGameUpdate"],
    executeFetchWithCircuitBreaker: (async () => null) as unknown as SourceRegistryApi["executeFetchWithCircuitBreaker"],
    getLatestForAllGames: (async () => []) as unknown as SourceRegistryApi["getLatestForAllGames"],
    fetchSteamReviewData: (async () => null) as unknown as SourceRegistryApi["fetchSteamReviewData"],
    enrichDealData: (async (deal: unknown) => deal) as unknown as SourceRegistryApi["enrichDealData"],
    fetchDeals: (async () => []) as unknown as SourceRegistryApi["fetchDeals"],
    searchSteamGameByName: (async () => null) as unknown as SourceRegistryApi["searchSteamGameByName"],
    chooseBestSteamMatch: (() => null) as unknown as SourceRegistryApi["chooseBestSteamMatch"],
    fetchSteamPriceDetails: (async () => null) as unknown as SourceRegistryApi["fetchSteamPriceDetails"],
    extractOfferEndFromHtml: (() => null) as unknown as SourceRegistryApi["extractOfferEndFromHtml"],
    extractSteamOfferEndDate: (async () => null) as unknown as SourceRegistryApi["extractSteamOfferEndDate"],
    cleanEnrichedCache: () => undefined,
    getEnrichedCacheSize: () => 0,
    formatPrice: value => `$${String(value ?? 0)}`,
    ...overrides
  };
}
