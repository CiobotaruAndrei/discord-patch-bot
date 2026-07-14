import axios from "axios";
import * as cheerio from "cheerio";
import Parser from "rss-parser";
import crypto from "crypto";
import type { CircuitBreakerStore } from "./updates/circuitBreakerStore.js";
import type { CurrencyCode, CurrencyConfig, PriceValue, RuntimeEnv } from "../types.js";

export interface SourceRuntimeDeps {
  env: RuntimeEnv;
  logger(level: string, context: string, message: string, meta?: unknown): void;
  getAbortSignal(): AbortSignal | null;
  getCurrencyConfig(code?: CurrencyCode | string | null): CurrencyConfig;
  formatPrice(value: PriceValue, currencyCode?: CurrencyCode | string | null): string;
  runConcurrent<T>(items: T[], concurrency: number, fn: (item: T, index: number) => void | Promise<unknown>, options?: unknown): Promise<{ processed: number; errors: Array<{ error: unknown }> }>;
  adminAlert(kind: string, title: string, body: unknown, guildId?: string): Promise<void>;
  SchemaDriftError: new (message: string, source?: string) => Error;
  circuitBreakerStore: CircuitBreakerStore;
}

export function createSourceRuntime(deps: SourceRuntimeDeps) {
  return {
    axios,
    cheerio,
    Parser,
    crypto,
    rssParser: new Parser(),
    ...deps
  };
}
