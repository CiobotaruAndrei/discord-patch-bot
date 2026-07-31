"use strict";

export interface PassiveArchiveFinding {
  status: "inspected" | "uncertain";
  indicators: string[];
  reason: string;
}

import { recordAnalysisBlindSpot, recordUninspectableFormat } from "./coverageGapMetrics.js";

export interface InspectionReport {
  status: "inspected" | "uncertain";
  indicators: string[];
  reason: string;
  entriesInspected: number;
  expandedBytes: number;
  elapsedMs: number;
  uninspectableFormat?: string;
  analysisBlindSpots?: string[];
}

export interface InspectionLimits {
  maxDepth: number;
  maxEntries: number;
  maxExpandedBytes: number;
  maxCompressionRatio: number;
  timeoutMs: number;
}

export interface InspectionBudget {
  entries: number;
  expandedBytes: number;
  startedAt: number;
  limits: InspectionLimits;
}

export const MAX_DEPTH = 3;
export const MAX_ENTRIES = 64;
export const MAX_EXPANDED_BYTES = 8 * 1024 * 1024;
export const MAX_COMPRESSION_RATIO = 100;
export const MAX_INSPECTION_MS = 100;

export const DEFAULT_INSPECTION_LIMITS: InspectionLimits = {
  maxDepth: MAX_DEPTH,
  maxEntries: MAX_ENTRIES,
  maxExpandedBytes: MAX_EXPANDED_BYTES,
  maxCompressionRatio: MAX_COMPRESSION_RATIO,
  timeoutMs: MAX_INSPECTION_MS
};

export function resolveLimits(limits: Partial<InspectionLimits>): InspectionLimits {
  return {
    maxDepth: limits.maxDepth && limits.maxDepth > 0 ? limits.maxDepth : DEFAULT_INSPECTION_LIMITS.maxDepth,
    maxEntries: limits.maxEntries && limits.maxEntries > 0 ? limits.maxEntries : DEFAULT_INSPECTION_LIMITS.maxEntries,
    maxExpandedBytes: limits.maxExpandedBytes && limits.maxExpandedBytes > 0 ? limits.maxExpandedBytes : DEFAULT_INSPECTION_LIMITS.maxExpandedBytes,
    maxCompressionRatio: limits.maxCompressionRatio && limits.maxCompressionRatio > 0 ? limits.maxCompressionRatio : DEFAULT_INSPECTION_LIMITS.maxCompressionRatio,
    timeoutMs: limits.timeoutMs && limits.timeoutMs > 0 ? limits.timeoutMs : DEFAULT_INSPECTION_LIMITS.timeoutMs
  };
}


export function uncertain(reason: string, indicators: string[] = []): PassiveArchiveFinding {
  return { status: "uncertain", indicators, reason };
}

export function inspected(indicators: string[]): PassiveArchiveFinding {
  return {
    status: "inspected",
    indicators: [...new Set(indicators)],
    reason: indicators.length > 0 ? "arhiva inspectata pasiv cu indicatori interni" : "arhiva inspectata pasiv fara indicatori interni"
  };
}

export function enforceBudget(budget: InspectionBudget, compressedBytes: number, expandedBytes: number): string | null {
  budget.entries++;
  budget.expandedBytes += expandedBytes;
  if (budget.entries > budget.limits.maxEntries) return `arhiva depaseste limita de ${budget.limits.maxEntries} intrari`;
  if (budget.expandedBytes > budget.limits.maxExpandedBytes) return `arhiva depaseste limita de ${budget.limits.maxExpandedBytes} bytes decomprimati`;
  if (compressedBytes > 0 && expandedBytes / compressedBytes > budget.limits.maxCompressionRatio) return `arhiva depaseste raportul maxim de compresie ${budget.limits.maxCompressionRatio}:1`;
  if (Date.now() - budget.startedAt > budget.limits.timeoutMs) return `inspectia arhivei a depasit ${budget.limits.timeoutMs} ms`;
  return null;
}
