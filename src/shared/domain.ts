import type { CurrencyCode, CurrencyConfig, PriceValue } from "../types";

type CurrencyRegistry = Record<CurrencyCode, CurrencyConfig>;

class SchemaDriftError extends Error {
  code: "SCHEMA_DRIFT";
  source: string;

  constructor(message: string, source?: string) {
    super(message);
    this.name = "SchemaDriftError";
    this.code = "SCHEMA_DRIFT";
    this.source = source || "unknown";
  }
}

const SUPPORTED_CURRENCIES: CurrencyRegistry = {
  USD: { cc: "US", symbol: "$", placement: "prefix" },
  EUR: { cc: "DE", symbol: "€", placement: "prefix" },
  GBP: { cc: "GB", symbol: "£", placement: "prefix" },
  RON: { cc: "RO", symbol: " lei", placement: "suffix" }
};
const DEFAULT_CURRENCY: CurrencyCode = "USD";

function getCurrencyConfig(code?: CurrencyCode | string | null): CurrencyConfig {
  const normalized = String(code || "").toUpperCase() as CurrencyCode;
  return SUPPORTED_CURRENCIES[normalized] || SUPPORTED_CURRENCIES[DEFAULT_CURRENCY];
}

function formatPrice(value: PriceValue, currencyCode?: CurrencyCode | string | null): string {
  const cfg = getCurrencyConfig(currencyCode);
  const num = Number(value);
  // V11: pe valori invalide (NaN, undefined coercion, "abc" string), afisam
  // "—" in loc de a injecta `String(value)` direct in template. Vechi: pentru
  // value=undefined produceam "$undefined", pentru value="abc" produceam "$abc".
  // Defensive: nu putem garanta intotdeauna ca pretul vine curat din upstream
  // (deal corupt in DB, fallback fallback parsing fail, etc.) si valorile
  // user-facing trebuie sa ramana ingrijite chiar pe edge cases.
  const formatted = Number.isFinite(num) ? num.toFixed(2) : "—";
  return cfg.placement === "prefix"
    ? `${cfg.symbol}${formatted}`
    : `${formatted}${cfg.symbol}`;
}

interface DomainContext {
  SchemaDriftError?: typeof SchemaDriftError;
  SUPPORTED_CURRENCIES?: CurrencyRegistry;
  DEFAULT_CURRENCY?: CurrencyCode;
  getCurrencyConfig?: typeof getCurrencyConfig;
  formatPrice?: typeof formatPrice;
}

function attachDomain(ctx: DomainContext): void {
  Object.assign(ctx, {
    SchemaDriftError,
    SUPPORTED_CURRENCIES,
    DEFAULT_CURRENCY,
    getCurrencyConfig,
    formatPrice
  });
}

export = attachDomain;
