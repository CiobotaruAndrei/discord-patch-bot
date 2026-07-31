import type { GameConfig } from "../../config/configTypes.js";
import type { SteamReviewData } from "../../sources/sourceTypes.js";
import type { ReviewSnapshot } from "./reviewTrendAnalysis.js";
import type { MissingDependencyKeys, ExtraDependencyKeys, ExactDependencyKeys } from "../../shared/dependencyKeyContract.js";

interface ReviewTrendLeanDoc {
  appId?: string;
  gameKey?: string;
  totalReviews?: number;
  qualityPercent?: number;
  fetchedAt?: Date | string | number;
}

interface ReviewTrendSnapshotModelLike {
  updateOne(filter: Record<string, string>, update: Record<string, object>, options: { upsert: true }): Promise<object>;
  find(filter: Record<string, object>): {
    sort(spec: Record<string, 1 | -1>): { lean(): Promise<ReviewTrendLeanDoc[]> };
  };
}

interface ReviewTrendSnapshotDeps {
  ReviewTrendSnapshotModel: ReviewTrendSnapshotModelLike;
  fetchSteamReviewData(appId: string | number): Promise<SteamReviewData>;
  logger(level: string, context: string, message: string, meta?: Record<string, string | number | boolean | null>): void;
}

export interface StoredReviewSnapshot extends ReviewSnapshot {
  appId: string;
  gameKey: string;
  at: Date;
}

export interface ReviewTrendRefreshResult {
  refreshed: number;
  failed: number;
}

const HOUR_MS = 60 * 60_000;

function validSnapshot(data: SteamReviewData): data is SteamReviewData & { success: true } {
  return data.success === true
    && Number.isFinite(data.totalReviews)
    && data.totalReviews >= 0
    && Number.isFinite(data.qualityPercent)
    && data.qualityPercent >= 0
    && data.qualityPercent <= 100;
}

function snapshotId(appId: string, at: Date): string {
  return `${appId}:${Math.floor(at.getTime() / HOUR_MS)}`;
}

function parseStoredSnapshot(doc: ReviewTrendLeanDoc): StoredReviewSnapshot | null {
  const appId = String(doc.appId || "");
  const at = new Date(doc.fetchedAt ?? Number.NaN);
  if (!appId || !Number.isFinite(at.getTime())) return null;
  if (!Number.isFinite(doc.totalReviews) || !Number.isFinite(doc.qualityPercent)) return null;
  const totalReviews = Number(doc.totalReviews);
  const qualityPercent = Number(doc.qualityPercent);
  if (totalReviews < 0 || qualityPercent < 0 || qualityPercent > 100) return null;
  return { appId, gameKey: String(doc.gameKey || ""), totalReviews, qualityPercent, at };
}

export function selectHistoricalReviewSnapshot(
  history: readonly StoredReviewSnapshot[],
  recentAt: Date,
  targetAgeDays = 7
): StoredReviewSnapshot | null {
  const target = recentAt.getTime() - targetAgeDays * 86_400_000;
  const minimumAge = recentAt.getTime() - 14 * 86_400_000;
  const maximumAge = recentAt.getTime() - 3 * 86_400_000;
  const candidates = history.filter(item => {
    const time = item.at.getTime();
    return time >= minimumAge && time <= maximumAge;
  });
  return candidates.reduce<StoredReviewSnapshot | null>((selected, item) => {
    if (!selected) return item;
    return Math.abs(item.at.getTime() - target) < Math.abs(selected.at.getTime() - target) ? item : selected;
  }, null);
}

export function createReviewTrendSnapshotService(deps: ReviewTrendSnapshotDeps) {
  async function recordReviewTrendSnapshot(appIdInput: string | number, gameKey: string, review: SteamReviewData, at = new Date()): Promise<boolean> {
    if (!validSnapshot(review)) return false;
    const appId = String(appIdInput);
    await deps.ReviewTrendSnapshotModel.updateOne(
      { _id: snapshotId(appId, at) },
      { $set: { appId, gameKey, totalReviews: review.totalReviews, qualityPercent: review.qualityPercent, fetchedAt: at } },
      { upsert: true }
    );
    return true;
  }

  async function readReviewTrendHistory(appIdInput: string | number, since: Date): Promise<StoredReviewSnapshot[]> {
    const docs = await deps.ReviewTrendSnapshotModel
      .find({ appId: { $eq: String(appIdInput) }, fetchedAt: { $gte: since } })
      .sort({ fetchedAt: 1 })
      .lean();
    return docs.map(parseStoredSnapshot).filter((item): item is StoredReviewSnapshot => item !== null);
  }

  async function refreshReviewTrendSnapshots(games: GameConfig[], shouldAbortInput?: (() => boolean) | null): Promise<ReviewTrendRefreshResult> {
    const shouldAbort = shouldAbortInput ?? (() => false);
    let refreshed = 0;
    let failed = 0;
    for (const game of games) {
      if (shouldAbort()) break;
      if (game.appId === undefined || game.appId === null || String(game.appId).trim() === "") continue;
      try {
        const review = await deps.fetchSteamReviewData(game.appId);
        if (await recordReviewTrendSnapshot(game.appId, game.key, review)) refreshed++;
        else failed++;
      } catch (error) {
        failed++;
        deps.logger("WARN", "REVIEW_TREND", "Snapshot-ul Steam reviews nu a putut fi salvat", {
          appId: String(game.appId),
          gameKey: game.key,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return { refreshed, failed };
  }

  return { recordReviewTrendSnapshot, readReviewTrendHistory, refreshReviewTrendSnapshots };
}

export default { createReviewTrendSnapshotService, selectHistoricalReviewSnapshot };

export const REVIEW_TREND_KEYS = [
  "ReviewTrendSnapshotModel",
  "fetchSteamReviewData",
  "logger"
] as const;

type ReviewTrendKeyCheckDeps = Parameters<typeof createReviewTrendSnapshotService>[0];
type ReviewTrendMissing = MissingDependencyKeys<ReviewTrendKeyCheckDeps, (typeof REVIEW_TREND_KEYS)[number] & string>;
type ReviewTrendExtra = ExtraDependencyKeys<ReviewTrendKeyCheckDeps, (typeof REVIEW_TREND_KEYS)[number] & string>;
const reviewtrendKeysComplete: ExactDependencyKeys<Exclude<Extract<keyof ReviewTrendKeyCheckDeps, string>, (typeof REVIEW_TREND_KEYS)[number] & string>, ReviewTrendExtra> = true;
