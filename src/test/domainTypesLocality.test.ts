import test from "node:test";
import assert from "node:assert/strict";

import type {
  ConfigBackupRecord as AggregatedConfigBackupRecord,
  DealInfo as AggregatedDealInfo,
  DeadLetterEntry as AggregatedDeadLetterEntry,
  FetchResult as AggregatedFetchResult,
  FutureReleaseGameEntry as AggregatedFutureReleaseGameEntry,
  LastErrorInfo as AggregatedLastErrorInfo,
  NormalizedUpdate as AggregatedNormalizedUpdate,
  NotificationMode as AggregatedNotificationMode,
  PendingDiscount as AggregatedPendingDiscount,
  PendingUpdate as AggregatedPendingUpdate,
  PriceAlertRule as AggregatedPriceAlertRule,
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
  Same<AggregatedNormalizedUpdate, NormalizedUpdate>
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
  true
];

test("tipurile de domeniu re-exportate prin agregatorul types.ts sunt identice cu definitiile din modulele de domeniu", () => {
  assert.equal(identityChecks.length, 14);
  assert.ok(identityChecks.every(check => check === true));
});
