import axios from "axios";
import type { RunConcurrent } from "../shared/concurrencyPort.js";

import * as cheerio from "cheerio";
import Parser from "rss-parser";
import crypto from "crypto";
import type { CircuitBreakerStore } from "./updates/circuitBreakerStore.js";
import type { CurrencyCode, CurrencyConfig, PriceValue } from "../types.js";
import type { RuntimeEnv } from "../config/runtimeEnvTypes.js";

export interface SourceRuntimeDeps {
  env: RuntimeEnv;
  logger(level: string, context: string, message: string, meta?: unknown): void;
  getAbortSignal(): AbortSignal | null;
  getCurrencyConfig(code?: CurrencyCode | string | null): CurrencyConfig;
  formatPrice(value: PriceValue, currencyCode?: CurrencyCode | string | null): string;
  runConcurrent: RunConcurrent;
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
