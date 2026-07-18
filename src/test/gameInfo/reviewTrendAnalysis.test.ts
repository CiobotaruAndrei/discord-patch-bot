import test from "node:test";
import assert from "node:assert/strict";

import { analyzeReviewTrend } from "../../features/game-info/reviewTrendAnalysis.js";

const T0 = Date.parse("2026-07-01T00:00:00.000Z");
const DAY = 86_400_000;

test("analyzeReviewTrend: fereastra anterioara lipsa => null (audit, #3)", () => {
  assert.equal(analyzeReviewTrend(null, { totalReviews: 10, qualityPercent: 90, at: T0 }), null);
  assert.equal(analyzeReviewTrend({ totalReviews: 10, qualityPercent: 90, at: T0 }, null), null);
});

test("analyzeReviewTrend: directia creste/scade/stabil dupa qualityPercent (audit, #3)", () => {
  const older = { totalReviews: 1000, qualityPercent: 80, at: T0 };
  assert.equal(analyzeReviewTrend(older, { totalReviews: 1010, qualityPercent: 85, at: T0 + 10 * DAY })?.direction, "improving");
  assert.equal(analyzeReviewTrend(older, { totalReviews: 1010, qualityPercent: 74, at: T0 + 10 * DAY })?.direction, "declining");
  assert.equal(analyzeReviewTrend(older, { totalReviews: 1010, qualityPercent: 81, at: T0 + 10 * DAY })?.direction, "stable");
});

test("analyzeReviewTrend: review-bombing PRUDENT - scadere brusca + aflux mare + fereastra scurta, cu nota ne-definitiva (audit, #3)", () => {
  const older = { totalReviews: 1000, qualityPercent: 90, at: T0 };
  const bombed = analyzeReviewTrend(older, { totalReviews: 1400, qualityPercent: 55, at: T0 + 2 * DAY });
  assert.ok(bombed);
  assert.equal(bombed.possibleReviewBombing, true);
  assert.equal(bombed.newReviews, 400);
  assert.match(bombed.note, /Posibil review-bombing/);
  assert.match(bombed.note, /necesita verificare umana/);
});

test("analyzeReviewTrend: scadere lenta sau aflux mic NU e semnalat drept review-bombing (audit, #3)", () => {
  const older = { totalReviews: 1000, qualityPercent: 90, at: T0 };
  const slowDrop = analyzeReviewTrend(older, { totalReviews: 1050, qualityPercent: 78, at: T0 + 30 * DAY });
  assert.equal(slowDrop?.possibleReviewBombing, false, "fereastra lunga => nu e bombing");
  const smallInflux = analyzeReviewTrend(older, { totalReviews: 1010, qualityPercent: 55, at: T0 + 2 * DAY });
  assert.equal(smallInflux?.possibleReviewBombing, false, "aflux mic (sub prag) => nu e bombing");
});

test("analyzeReviewTrend: volumele mici nu produc false positive indiferent de raport", () => {
  const result = analyzeReviewTrend(
    { totalReviews: 5, qualityPercent: 100, at: T0 },
    { totalReviews: 6, qualityPercent: 50, at: T0 + DAY }
  );
  assert.equal(result?.possibleReviewBombing, false);
  assert.equal(result?.confidence, "low");
});

test("analyzeReviewTrend: pragurile de volum sunt configurabile", () => {
  const result = analyzeReviewTrend(
    { totalReviews: 100, qualityPercent: 90, at: T0 },
    { totalReviews: 130, qualityPercent: 70, at: T0 + DAY },
    { bombingMinNewReviews: 20, bombingMinBaselineReviews: 50 }
  );
  assert.equal(result?.possibleReviewBombing, true);
  assert.equal(result?.confidence, "medium");
});

test("analyzeReviewTrend: snapshot-urile corupte sau regresive sunt refuzate", () => {
  assert.equal(analyzeReviewTrend(
    { totalReviews: 100, qualityPercent: 101, at: T0 },
    { totalReviews: 120, qualityPercent: 70, at: T0 + DAY }
  ), null);
  assert.equal(analyzeReviewTrend(
    { totalReviews: 100, qualityPercent: 80, at: T0 },
    { totalReviews: 90, qualityPercent: 70, at: T0 + DAY }
  ), null);
});
