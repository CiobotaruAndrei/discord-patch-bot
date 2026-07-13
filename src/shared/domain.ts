import type { CurrencyCode, CurrencyConfig, CurrencyRegistry, PriceValue } from "../types";

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

function buildDomainFrom(_context: DomainContext) {
  return {
    SchemaDriftError,
    SUPPORTED_CURRENCIES,
    DEFAULT_CURRENCY,
    getCurrencyConfig,
    formatPrice
  };
}

function attachDomain(target: DomainContext): void {
  Object.assign(target, buildDomainFrom(target));
}

attachDomain.buildFrom = buildDomainFrom;

export default attachDomain;
