"use strict";

export type ReviewSnapshot = { at: Date | string | number; positive: number; negative: number; total?: number };
export type ReviewTrend = { positiveDelta: number; negativeDelta: number; scoreDelta: number; reviewBomb: boolean; samples: number };

function score(item: ReviewSnapshot): number {
  const total = Math.max(1, item.total ?? item.positive + item.negative);
  return item.positive / total;
}

export function calculateReviewTrend(history: ReviewSnapshot[], now = Date.now()): ReviewTrend | null {
  const recent = history.filter(item => Number.isFinite(new Date(item.at).getTime()) && new Date(item.at).getTime() <= now).sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  if (recent.length < 2) return null;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const positiveDelta = last.positive - first.positive;
  const negativeDelta = last.negative - first.negative;
  const scoreDelta = score(last) - score(first);
  return { positiveDelta, negativeDelta, scoreDelta, reviewBomb: scoreDelta <= -0.15 && negativeDelta > Math.max(10, positiveDelta * 2), samples: recent.length };
}

export default { calculateReviewTrend };
