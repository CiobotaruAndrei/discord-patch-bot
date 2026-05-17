// @ts-check
"use strict";

/** @typedef {import("../../types").BotMetrics} BotMetrics */

function createMetrics() {
  /** @type {BotMetrics} */
  const metrics = {
    fetchSuccess: 0,
    fetchFail: 0,
    httpRetries: 0,
    rateLimitHits: 0,
    cronRuns: 0,
    cronErrors: 0,
    cronSkippedDueToLock: 0,
    cronSkippedDueToHealth: 0,
    cronAborted: 0,
    httpRateLimitDrops: 0,
    startedAt: Date.now()
  };
  return metrics;
}

module.exports = { createMetrics };
