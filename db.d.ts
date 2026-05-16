import type { AsyncLocalStorage } from "node:async_hooks";
import type { Model } from "mongoose";
import type {
  ConcurrentRunResult,
  CurrencyCode,
  CurrencyConfig,
  DealInfo,
  GuildSettings,
  LogLevel,
  RuntimeEnv,
  SystemTimes
} from "./types";

export type EnvConfig = RuntimeEnv;
export type RunConcurrentResult<T> = ConcurrentRunResult<T>;
export type RunConcurrentError<T> = ConcurrentRunResult<T>["errors"][number];

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

export function logger(level: LogLevel | string, context: string, message: string, meta?: unknown): void;
export const env: RuntimeEnv;
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
): Promise<ConcurrentRunResult<T>>;
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
