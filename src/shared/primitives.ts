"use strict";

export type CurrencyCode = "USD" | "EUR" | "GBP" | "RON";
export type MaybePromise<T> = T | Promise<T>;
export type PriceValue = string | number;
export type CurrencyPlacement = "prefix" | "suffix";
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
export type LoggerFunction = (level: LogLevel | string, context: string, message: string, meta?: unknown) => void;
