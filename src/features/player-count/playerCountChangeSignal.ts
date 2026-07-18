"use strict";

export interface PlayerCountChange {
  absoluteChange: number;
  percentChange: number;
  direction: "up" | "down" | "flat";
  significant: boolean;
}

const DEFAULT_MIN_PERCENT = 25;
const DEFAULT_MIN_ABSOLUTE = 50;

export function evaluatePlayerCountChange(
  previous: number | null | undefined,
  current: number,
  options?: { minPercent?: number; minAbsolute?: number }
): PlayerCountChange {
  const minPercent = options?.minPercent ?? DEFAULT_MIN_PERCENT;
  const minAbsolute = options?.minAbsolute ?? DEFAULT_MIN_ABSOLUTE;
  if (previous == null || !Number.isFinite(previous) || previous < 0 || !Number.isFinite(current)) {
    return { absoluteChange: 0, percentChange: 0, direction: "flat", significant: false };
  }
  const absoluteChange = current - previous;
  const direction = absoluteChange > 0 ? "up" : absoluteChange < 0 ? "down" : "flat";
  const percentChange = previous === 0
    ? (current > 0 ? 100 : 0)
    : Math.round((absoluteChange / previous) * 1000) / 10;
  const significant = Math.abs(absoluteChange) >= minAbsolute && Math.abs(percentChange) >= minPercent;
  return { absoluteChange, percentChange, direction, significant };
}

export default { evaluatePlayerCountChange };
