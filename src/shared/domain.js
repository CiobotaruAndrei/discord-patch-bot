"use strict";

module.exports = (ctx) => {
class SchemaDriftError extends Error {
  constructor(message, source) {
    super(message);
    this.name = "SchemaDriftError";
    this.code = "SCHEMA_DRIFT";
    this.source = source || "unknown";
  }
}

// -------------------------------------------------------------
// CURRENCY
// -------------------------------------------------------------
const SUPPORTED_CURRENCIES = {
  USD: { cc: "US", symbol: "$",   placement: "prefix" },
  EUR: { cc: "DE", symbol: "€",   placement: "prefix" },
  GBP: { cc: "GB", symbol: "£",   placement: "prefix" },
  RON: { cc: "RO", symbol: " lei", placement: "suffix" }
};
const DEFAULT_CURRENCY = "USD";

function getCurrencyConfig(code) {
  return SUPPORTED_CURRENCIES[String(code || "").toUpperCase()] || SUPPORTED_CURRENCIES[DEFAULT_CURRENCY];
}

function formatPrice(value, currencyCode) {
  const cfg = getCurrencyConfig(currencyCode);
  const num = Number(value);
  const formatted = Number.isFinite(num) ? num.toFixed(2) : String(value);
  return cfg.placement === "prefix"
    ? `${cfg.symbol}${formatted}`
    : `${formatted}${cfg.symbol}`;
}

  Object.assign(ctx, {
    SchemaDriftError,
    SUPPORTED_CURRENCIES,
    DEFAULT_CURRENCY,
    getCurrencyConfig,
    formatPrice
  });
};
