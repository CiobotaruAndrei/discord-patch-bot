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
  const rawPercentChange = previous === 0
    ? (current > 0 ? 100 : 0)
    : (absoluteChange / previous) * 100;
  const percentChange = Math.round(rawPercentChange * 10) / 10;
  const significant = Math.abs(absoluteChange) >= minAbsolute && Math.abs(rawPercentChange) >= minPercent;
  return { absoluteChange, percentChange, direction, significant };
}

export default { evaluatePlayerCountChange };
