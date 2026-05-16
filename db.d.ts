import type { AsyncLocalStorage } from "node:async_hooks";
import type { Model } from "mongoose";
import type { CurrencyCode, DealInfo, GuildSettings, SystemTimes } from "./types";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | string;

export interface CurrencyConfig {
  cc: string;
  symbol: string;
  placement: "prefix" | "suffix";
}

export interface EnvConfig {
  MONGO_URI?: string;
  DISCORD_TOKEN?: string;
  DISCORD_CLIENT_ID?: string;
  PORT: string;
  NODE_ENV: string;
  METRICS_TOKEN: string;
  METRICS_PUBLIC: boolean;
  ADMIN_WEBHOOK_URL: string;
  LOG_LEVEL: string;
  PROXY_URLS: string;
  FETCH_CONCURRENCY: number;
  MAX_HTML_BYTES: number;
  MAX_JSON_BYTES: number;
  MAX_DEALS: number;
  STEAM_SPECIALS_LIMIT: number;
  EPIC_SPECIALS_LIMIT: number;
  STEAM_REVIEW_BATCH_SIZE: number;
  STEAM_REVIEW_BATCH_DELAY_MS: number;
  DISCORD_SEND_DELAY_MS: number;
  MAX_UPDATES_PER_CYCLE: number;
  MAX_DEALS_PER_CYCLE: number;
  GUILD_PROCESS_CONCURRENCY: number;
  SEEN_PER_GAME_LIMIT: number;
  DEALS_HISTORY_LIMIT: number;
  PENDING_UPDATES_PER_GAME_LIMIT: number;
  PENDING_DISCOUNTS_LIMIT: number;
  PENDING_UPDATE_MAX_AGE_MS: number;
  PENDING_DISCOUNT_GRACE_CYCLES: number;
  PENDING_UPDATE_MAX_ATTEMPTS: number;
  PENDING_DISCOUNT_MAX_ATTEMPTS: number;
  MAX_FUZZY_SEARCH_INPUT: number;
  INFLIGHT_PROMISE_TIMEOUT_MS: number;
  USER_COMMAND_COOLDOWN_MS: number;
  CIRCUIT_BREAKER_FAIL_THRESHOLD: number;
  CIRCUIT_BREAKER_COOLDOWN_MS: number;
  CIRCUIT_BREAKER_JITTER_MS: number;
  SCHEMA_DRIFT_THRESHOLD: number;
  COLLECTOR_TIMEOUT_MS: number;
  HOUSEKEEPING_INTERVAL_MS: number;
  GUILD_CACHE_TTL_MS: number;
  ADMIN_ALERT_COOLDOWN_MS: number;
  SHUTDOWN_DRAIN_MS: number;
  ENRICHED_DEAL_CACHE_TTL_MS: number;
  ENRICHED_DEAL_CACHE_MAX_SIZE: number;
  CACHE_TTL_MS: number;
  SINGLE_CACHE_MAX_SIZE: number;
  DLC_CACHE_MAX_SIZE: number;
  ITEMS_PER_PAGE: number;
  DLC_ITEMS_PER_PAGE: number;
  COMMAND_OUTPUT_MAX_CHARS: number;
  MONGO_MAX_POOL_SIZE: number;
  HTTP_RATE_LIMIT_REQ: number;
  HTTP_RATE_LIMIT_WINDOW_MS: number;
  isProd: boolean;
}

export interface RunConcurrentError<T> {
  index: number;
  item: T;
  error: unknown;
}

export interface RunConcurrentResult<T> {
  processed: number;
  errors: Array<RunConcurrentError<T>>;
}

export interface CircuitBreakerState {
  _id: string;
  fails?: number;
  cooldownUntil?: Date | null;
  alertSent?: boolean;
  schemaDriftFails?: number;
  schemaDriftAlertSent?: boolean;
  [key: string]: unknown;
}

export interface JobLockState {
  _id: string;
  lockedUntil?: Date | null;
  ownerToken?: string | null;
}

export interface AdminAlertCooldownState {
  _id: string;
  lastSentAt?: Date;
}

export class SchemaDriftError extends Error {
  code: "SCHEMA_DRIFT";
  source: string;
  constructor(message: string, source?: string);
}

export function logger(level: LogLevel, context: string, message: string, meta?: unknown): void;
export const env: EnvConfig;
export function parseEnvNumber(
  name: string,
  defaultValue: number,
  options?: { min?: number; max?: number }
): number;
export function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => unknown | Promise<unknown>,
  options?: {
    shouldAbort?: (() => boolean) | null;
    errorLogger?: ((item: T, error: unknown) => void) | null;
  }
): Promise<RunConcurrentResult<T>>;
export function waitForMongoReady(timeoutMs?: number): Promise<boolean>;
export function validatePendingDiscountSnapshot(snapshot: unknown): snapshot is DealInfo;

export const GuildModel: Model<GuildSettings>;
export const CircuitBreakerModel: Model<CircuitBreakerState>;
export const SystemModel: Model<{ _id: string; executionTimes?: SystemTimes }>;
export const JobLockModel: Model<JobLockState>;
export const AdminAlertCooldownModel: Model<AdminAlertCooldownState>;

export function acquireDbLock(jobName: string, ttlMs?: number): Promise<string | null>;
export function renewDbLock(jobName: string, token?: string | null, ttlMs?: number): Promise<boolean>;
export function releaseDbLock(jobName: string, token?: string | null): Promise<void>;
export const activeLocks: Map<string, string>;

export function getSystemTimes(): Promise<SystemTimes>;
export function saveSystemTimes(times: SystemTimes): Promise<void>;
export function getGuildSettings(guildId: string): Promise<GuildSettings | null>;
export function invalidateGuildCache(guildId: string): void;
export function cleanGuildCache(): void;
export function getGuildCacheSize(): number;
export function adminAlert(kind: string, title: string, body: string): Promise<void>;

export const SUPPORTED_CURRENCIES: Record<CurrencyCode, CurrencyConfig>;
export const DEFAULT_CURRENCY: CurrencyCode;
export function getCurrencyConfig(code?: string): CurrencyConfig;
export function formatPrice(value: string | number, currencyCode?: string): string;
export const requestContext: AsyncLocalStorage<{ requestId?: string; [key: string]: unknown }>;
