"use strict";

import type { GameConfig } from "../../config/configTypes.js";
import type { SteamReviewData } from "../../sources/sourceTypes.js";
import type { SteamCurrentPlayersSummary } from "../../sources/sourceApis.js";
import type { PlayerCountHistoryPoint } from "../player-count/playerCountSnapshotService.js";
import { calculatePlayerCountStats, type PlayerCountStats } from "../player-count/playerCountTimeAnalysis.js";
import { analyzeReviewTrend, type ReviewTrendAnalysis } from "./reviewTrendAnalysis.js";
import { selectHistoricalReviewSnapshot, type StoredReviewSnapshot } from "./reviewTrendSnapshotService.js";

const REVIEW_TREND_WINDOW_MS = 15 * 86_400_000;
const PLAYER_COUNT_WINDOW_MS = 24 * 60 * 60_000;

export type FreshSnapshot = { playerCount: number };

export type ReviewTrendData = { review: SteamReviewData; analysis: ReviewTrendAnalysis | null };

export type ReviewTrendPorts = {
  fetchReview: (appId: string | number) => Promise<SteamReviewData>;
  readHistory?: (appId: string | number, since: Date) => Promise<StoredReviewSnapshot[]>;
  recordSnapshot?: (appId: string | number, gameKey: string, review: SteamReviewData, at: Date) => Promise<boolean>;
  now: () => Date;
};

export async function assembleReviewTrend(
  appId: string | number,
  query: string,
  ports: ReviewTrendPorts
): Promise<ReviewTrendData> {
  const review = await ports.fetchReview(appId);
  const now = ports.now();
  const history = ports.readHistory
    ? await ports.readHistory(appId, new Date(now.getTime() - REVIEW_TREND_WINDOW_MS)).catch(() => [])
    : [];
  const older = selectHistoricalReviewSnapshot(history, now);
  const recent = review.success ? { totalReviews: review.totalReviews, qualityPercent: review.qualityPercent, at: now } : null;
  const analysis = analyzeReviewTrend(older, recent);
  if (ports.recordSnapshot) await ports.recordSnapshot(appId, query, review, now).catch(() => false);
  return { review, analysis };
}

export type PlayerCountData = { players: SteamCurrentPlayersSummary; stats: PlayerCountStats | null };

export type PlayerCountPorts = {
  readFreshSnapshots: (appIds: readonly string[]) => Promise<Map<string, FreshSnapshot>>;
  fetchCurrentPlayers: (appId: string | number) => Promise<SteamCurrentPlayersSummary>;
  readHistory?: (appIds: readonly string[], since: Date) => Promise<PlayerCountHistoryPoint[]>;
  now: () => Date;
};

export async function assemblePlayerCount(appId: string | number, ports: PlayerCountPorts): Promise<PlayerCountData> {
  const key = String(appId);
  const to = ports.now();
  const from = new Date(to.getTime() - PLAYER_COUNT_WINDOW_MS);
  const fresh = await ports.readFreshSnapshots([key]);
  const snapshot = fresh.get(key);
  const players = snapshot
    ? { appId: key, playerCount: snapshot.playerCount, success: true }
    : await ports.fetchCurrentPlayers(appId);
  const history = ports.readHistory ? await ports.readHistory([key], from).catch(() => []) : [];
  return { players, stats: calculatePlayerCountStats(history, { from, to }) };
}

export type TopActiveEntry = { game: GameConfig; players: SteamCurrentPlayersSummary };

export type TopActiveData = { playerCounts: TopActiveEntry[]; notChecked: number };

export type TopActivePorts = {
  readFreshSnapshots: (appIds: readonly string[]) => Promise<Map<string, FreshSnapshot>>;
  fetchCurrentPlayers: (appId: string) => Promise<SteamCurrentPlayersSummary>;
  mapWithConcurrency: <T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) => Promise<R[]>;
  onFetchFailed: (appId: string, error: unknown) => void;
  candidateCap: number;
  concurrency: number;
};

export async function assembleTopActive(games: readonly GameConfig[], ports: TopActivePorts): Promise<TopActiveData> {
  const fresh = await ports.readFreshSnapshots(games.map(game => String(game.appId)));
  const fromSnapshots: TopActiveEntry[] = [];
  const missing: GameConfig[] = [];
  for (const game of games) {
    const appId = String(game.appId);
    const snapshot = fresh.get(appId);
    if (snapshot) fromSnapshots.push({ game, players: { appId, playerCount: snapshot.playerCount, success: true } });
    else missing.push(game);
  }

  const toFetch = missing.slice(0, ports.candidateCap);
  const live = await ports.mapWithConcurrency(toFetch, ports.concurrency, async game => {
    const appId = String(game.appId);
    try {
      return { game, players: await ports.fetchCurrentPlayers(appId) };
    } catch (error: unknown) {
      ports.onFetchFailed(appId, error);
      return { game, players: { appId, playerCount: 0, success: false } };
    }
  });

  return { playerCounts: [...fromSnapshots, ...live], notChecked: Math.max(0, missing.length - toFetch.length) };
}
