"use strict";

export interface ReviewSnapshot {
  totalReviews: number;
  qualityPercent: number;
  at: Date | string | number;
}

export interface ReviewTrendAnalysis {
  direction: "improving" | "declining" | "stable";
  qualityDelta: number;
  newReviews: number;
  windowDays: number | null;
  possibleReviewBombing: boolean;
  confidence: "low" | "medium" | "high";
  note: string;
}

export interface ReviewTrendThresholds {
  stableBand: number;
  bombingQualityDrop: number;
  bombingInfluxRatio: number;
  bombingMaxWindowDays: number;
  bombingMinBaselineReviews: number;
  bombingMinNewReviews: number;
}

const QUALITY_STABLE_BAND = 2;
const BOMBING_QUALITY_DROP = 10;
const BOMBING_INFLUX_RATIO = 0.2;
const BOMBING_MAX_WINDOW_DAYS = 7;
const BOMBING_MIN_BASELINE_REVIEWS = 100;
const BOMBING_MIN_NEW_REVIEWS = 50;

const DEFAULT_THRESHOLDS: ReviewTrendThresholds = {
  stableBand: QUALITY_STABLE_BAND,
  bombingQualityDrop: BOMBING_QUALITY_DROP,
  bombingInfluxRatio: BOMBING_INFLUX_RATIO,
  bombingMaxWindowDays: BOMBING_MAX_WINDOW_DAYS,
  bombingMinBaselineReviews: BOMBING_MIN_BASELINE_REVIEWS,
  bombingMinNewReviews: BOMBING_MIN_NEW_REVIEWS
};

function toMillis(value: Date | string | number): number {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.NaN;
}

export function analyzeReviewTrend(
  older: ReviewSnapshot | null | undefined,
  recent: ReviewSnapshot | null | undefined,
  configured: Partial<ReviewTrendThresholds> = {}
): ReviewTrendAnalysis | null {
  if (!older || !recent) return null;
  if (!Number.isFinite(older.totalReviews) || !Number.isFinite(recent.totalReviews)
    || !Number.isFinite(older.qualityPercent) || !Number.isFinite(recent.qualityPercent)
    || older.totalReviews < 0 || recent.totalReviews < older.totalReviews
    || older.qualityPercent < 0 || older.qualityPercent > 100
    || recent.qualityPercent < 0 || recent.qualityPercent > 100) return null;
  const thresholds = { ...DEFAULT_THRESHOLDS, ...configured };
  const qualityDelta = Math.round((recent.qualityPercent - older.qualityPercent) * 10) / 10;
  const newReviews = Math.max(0, recent.totalReviews - older.totalReviews);
  const direction = qualityDelta > thresholds.stableBand ? "improving" : qualityDelta < -thresholds.stableBand ? "declining" : "stable";

  const olderAt = toMillis(older.at);
  const recentAt = toMillis(recent.at);
  const spanDays = Number.isFinite(olderAt) && Number.isFinite(recentAt) && recentAt > olderAt
    ? (recentAt - olderAt) / 86_400_000
    : null;
  const influxRatio = newReviews / Math.max(1, older.totalReviews);
  const sufficientVolume = older.totalReviews >= thresholds.bombingMinBaselineReviews
    && newReviews >= thresholds.bombingMinNewReviews;
  const possibleReviewBombing = sufficientVolume
    && qualityDelta <= -thresholds.bombingQualityDrop
    && influxRatio >= thresholds.bombingInfluxRatio
    && spanDays !== null
    && spanDays <= thresholds.bombingMaxWindowDays;
  const confidence = older.totalReviews >= 10_000 && newReviews >= 500
    ? "high"
    : sufficientVolume
      ? "medium"
      : "low";

  const note = possibleReviewBombing
    ? "Posibil review-bombing: scadere brusca de calitate cu aflux mare de recenzii intr-un interval scurt - necesita verificare umana, nu e o concluzie definitiva."
    : direction === "declining"
      ? "Calitatea recenziilor scade fata de fereastra anterioara."
      : direction === "improving"
        ? "Calitatea recenziilor creste fata de fereastra anterioara."
        : "Tendinta recenziilor e stabila.";

  return {
    direction,
    qualityDelta,
    newReviews,
    windowDays: spanDays === null ? null : Math.round(spanDays * 10) / 10,
    possibleReviewBombing,
    confidence,
    note
  };
}

export default { analyzeReviewTrend };
