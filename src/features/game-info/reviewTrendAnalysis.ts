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
  note: string;
}

const QUALITY_STABLE_BAND = 2;
const BOMBING_QUALITY_DROP = 10;
const BOMBING_INFLUX_RATIO = 0.2;
const BOMBING_MAX_WINDOW_DAYS = 7;

function toMillis(value: Date | string | number): number {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.NaN;
}

export function analyzeReviewTrend(older: ReviewSnapshot | null | undefined, recent: ReviewSnapshot | null | undefined): ReviewTrendAnalysis | null {
  if (!older || !recent) return null;
  const qualityDelta = Math.round((recent.qualityPercent - older.qualityPercent) * 10) / 10;
  const newReviews = Math.max(0, recent.totalReviews - older.totalReviews);
  const direction = qualityDelta > QUALITY_STABLE_BAND ? "improving" : qualityDelta < -QUALITY_STABLE_BAND ? "declining" : "stable";

  const olderAt = toMillis(older.at);
  const recentAt = toMillis(recent.at);
  const spanDays = Number.isFinite(olderAt) && Number.isFinite(recentAt) && recentAt > olderAt
    ? (recentAt - olderAt) / 86_400_000
    : null;
  const influxRatio = newReviews / Math.max(1, older.totalReviews);
  const possibleReviewBombing = qualityDelta <= -BOMBING_QUALITY_DROP
    && influxRatio >= BOMBING_INFLUX_RATIO
    && spanDays !== null
    && spanDays <= BOMBING_MAX_WINDOW_DAYS;

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
    note
  };
}

export default { analyzeReviewTrend };
