import test from "node:test";
import assert from "node:assert/strict";

import type {
  BotConfig as AggregatedBotConfig,
  BotMetrics as AggregatedBotMetrics,
  ConfigBackupRecord as AggregatedConfigBackupRecord,
  ConfigLoadResult as AggregatedConfigLoadResult,
  CronController as AggregatedCronController,
  CronHealthSnapshot as AggregatedCronHealthSnapshot,
  DealInfo as AggregatedDealInfo,
  DeadLetterEntry as AggregatedDeadLetterEntry,
  FetchResult as AggregatedFetchResult,
  FutureReleaseGameEntry as AggregatedFutureReleaseGameEntry,
  GameConfig as AggregatedGameConfig,
  GameSourceFallback as AggregatedGameSourceFallback,
  GameType as AggregatedGameType,
  LastErrorInfo as AggregatedLastErrorInfo,
  NormalizedUpdate as AggregatedNormalizedUpdate,
  NotificationMode as AggregatedNotificationMode,
  PendingDiscount as AggregatedPendingDiscount,
  PendingUpdate as AggregatedPendingUpdate,
  PriceAlertRule as AggregatedPriceAlertRule,
  RateLimitBucket as AggregatedRateLimitBucket,
  RateLimiter as AggregatedRateLimiter,
  RateLimitRequest as AggregatedRateLimitRequest,
  YouTubeChannelSubscription as AggregatedYouTubeChannelSubscription,
  YouTubeVideo as AggregatedYouTubeVideo,
  YouTubeVideoMetadata as AggregatedYouTubeVideoMetadata
} from "../types";
import type {
  ConfigBackupRecord,
  FutureReleaseGameEntry
} from "../features/admin-records/adminRecordsTypes";
import type {
  DeadLetterEntry,
  LastErrorInfo,
  NotificationMode,
  PendingDiscount,
  PendingUpdate,
  PriceAlertRule
} from "../features/notifications/notificationTypes";
import type {
  YouTubeChannelSubscription,
  YouTubeVideo,
  YouTubeVideoMetadata
} from "../features/youtube/youtubeTypes";
import type { DealInfo, FetchResult, NormalizedUpdate } from "../sources/sourceTypes";
import type {
  BotConfig,
  ConfigLoadResult,
  GameConfig,
  GameSourceFallback,
  GameType
} from "../config/configTypes";
import type { BotMetrics } from "../app/health/metricsTypes";
import type { RateLimitBucket, RateLimiter, RateLimitRequest } from "../app/health/rateLimitTypes";
import type { CronController, CronHealthSnapshot } from "../app/scheduler/schedulerTypes";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type IdentityChecks = [
  Same<AggregatedConfigBackupRecord, ConfigBackupRecord>,
  Same<AggregatedFutureReleaseGameEntry, FutureReleaseGameEntry>,
  Same<AggregatedNotificationMode, NotificationMode>,
  Same<AggregatedLastErrorInfo, LastErrorInfo>,
  Same<AggregatedPendingUpdate, PendingUpdate>,
  Same<AggregatedPendingDiscount, PendingDiscount>,
  Same<AggregatedPriceAlertRule, PriceAlertRule>,
  Same<AggregatedDeadLetterEntry, DeadLetterEntry>,
  Same<AggregatedYouTubeChannelSubscription, YouTubeChannelSubscription>,
  Same<AggregatedYouTubeVideo, YouTubeVideo>,
  Same<AggregatedYouTubeVideoMetadata, YouTubeVideoMetadata>,
  Same<AggregatedDealInfo, DealInfo>,
  Same<AggregatedFetchResult, FetchResult>,
  Same<AggregatedNormalizedUpdate, NormalizedUpdate>,
  Same<AggregatedGameType, GameType>,
  Same<AggregatedGameSourceFallback, GameSourceFallback>,
  Same<AggregatedGameConfig, GameConfig>,
  Same<AggregatedBotConfig, BotConfig>,
  Same<AggregatedConfigLoadResult, ConfigLoadResult>,
  Same<AggregatedBotMetrics, BotMetrics>,
  Same<AggregatedRateLimitBucket, RateLimitBucket>,
  Same<AggregatedRateLimitRequest, RateLimitRequest>,
  Same<AggregatedRateLimiter, RateLimiter>,
  Same<AggregatedCronHealthSnapshot, CronHealthSnapshot>,
  Same<AggregatedCronController, CronController>
];

const identityChecks: IdentityChecks = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true
];

test("tipurile de domeniu re-exportate prin agregatorul types.ts sunt identice cu definitiile din modulele de domeniu", () => {
  assert.equal(identityChecks.length, 25);
  assert.ok(identityChecks.every(check => check === true));
});

test("modulele de domeniu detin definitiile (nu agregatorul types.ts): config/health/scheduler", () => {
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const srcRoot = process.cwd();
  const read = (rel: string): string => fs.readFileSync(path.join(srcRoot, rel), "utf8");

  const configTypes = read("config/configTypes.ts");
  assert.match(configTypes, /export interface GameConfig\b/);
  assert.match(configTypes, /export interface BotConfig\b/);
  assert.match(configTypes, /export type GameType\b/);
  const metricsTypes = read("app/health/metricsTypes.ts");
  assert.match(metricsTypes, /export interface BotMetrics\b/);
  const rateLimitTypes = read("app/health/rateLimitTypes.ts");
  assert.match(rateLimitTypes, /export interface RateLimiter\b/);
  const schedulerTypes = read("app/scheduler/schedulerTypes.ts");
  assert.match(schedulerTypes, /export interface CronController\b/);

  const aggregator = read("types.ts");
  assert.ok(!/\nexport interface GameConfig\b/.test(aggregator), "GameConfig nu mai e definit inline in types.ts");
  assert.ok(!/\nexport interface BotMetrics\b/.test(aggregator), "BotMetrics nu mai e definit inline in types.ts");
  assert.ok(!/\nexport interface RateLimiter\b/.test(aggregator), "RateLimiter nu mai e definit inline in types.ts");
  assert.ok(!/\nexport interface CronController\b/.test(aggregator), "CronController nu mai e definit inline in types.ts");
  assert.match(aggregator, /export type \{[\s\S]*?GameConfig[\s\S]*?\} from "\.\/config\/configTypes"/);
  assert.match(aggregator, /export type \{ BotMetrics \} from "\.\/app\/health\/metricsTypes"/);
  assert.match(aggregator, /from "\.\/app\/scheduler\/schedulerTypes"/);
});
