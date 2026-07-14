import type { CheerioAPI } from "cheerio";
import type {
  BotMetrics,
  FetchResult,
  GameConfig,
  HttpRequestOptions,
  LoggerFunction,
  NormalizedUpdate,
  PatchUpdate
} from "../../types.js";
import type { UpdatesApi } from "../sourceApis.js";
import type { HttpReq, RssParserLike, RunConcurrent, SchemaDriftErrorClass, TrackInflight, WithInflightTimeout } from "./updateHelpers.js";
import type { CircuitBreakerStore } from "./circuitBreakerStore.js";

export interface CircuitBreakerDoc {
  _id: string;
  fails?: number;
  cooldownUntil?: Date | string | null;
  alertSent?: boolean;
  schemaDriftFails?: number;
  schemaDriftAlertSent?: boolean;
}

export interface CircuitBreakerModelLike {
  findOneAndUpdate(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<CircuitBreakerDoc | null>;
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export interface UpdatesDeps {
  rssParser: RssParserLike;
  circuitBreakerStore: CircuitBreakerStore;
  logger: LoggerFunction;
  adminAlert: (kind: string, title: string, body: string) => Promise<void>;
  runConcurrent: RunConcurrent;
  SchemaDriftError: SchemaDriftErrorClass;
  FETCH_CONCURRENCY: number;
  FETCH_CONCURRENCY_STEAM: number;
  FETCH_CONCURRENCY_EPIC: number;
  FETCH_CONCURRENCY_LISTING: number;
  FETCH_CONCURRENCY_DRIVER: number;
  CIRCUIT_BREAKER_FAIL_THRESHOLD: number;
  CIRCUIT_BREAKER_COOLDOWN_MS: number;
  CIRCUIT_BREAKER_JITTER_MS: number;
  SCHEMA_DRIFT_THRESHOLD: number;
  httpReq: HttpReq;
  conditionalGet: <T>(url: string, parse: (data: unknown) => T | Promise<T>, options?: HttpRequestOptions) => Promise<T>;
  fetchWithProxy: (targetUrl: string, options?: HttpRequestOptions) => Promise<string>;
  withInflightTimeout: WithInflightTimeout;
  trackInflight: TrackInflight;
  cleanText: (text: unknown) => string;
  stableUpdateId: (title: unknown, link: unknown) => string;
  normalizeUpdate: (data: PatchUpdate) => NormalizedUpdate;
  safeCheerioLoad: (html: unknown) => CheerioAPI;
  crypto: typeof import("crypto");
  getHttpMetrics(): Pick<BotMetrics, "fetchSuccess" | "fetchFail">;
  executeFetchWithCircuitBreaker?: (game: GameConfig) => Promise<FetchResult>;
}

export type UpdatesContext = UpdatesDeps & Partial<UpdatesApi>;
