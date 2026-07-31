import type { PriceValue } from "../../types.js";
import type { DealInfo } from "../../sources/sourceTypes.js";
import type { MissingDependencyKeys, ExtraDependencyKeys, ExactDependencyKeys } from "../../shared/dependencyKeyContract.js";

interface DealPriceLeanDoc {
  gameKey?: string;
  title?: string;
  store?: string;
  currency?: string;
  price?: number;
  fetchedAt?: Date | string | number;
}

interface DealPriceSnapshotModelLike {
  bulkWrite(operations: Array<{
    updateOne: {
      filter: { _id: string };
      update: { $set: DealPriceSnapshotDocument };
      upsert: true;
    };
  }>): Promise<object>;
  find(filter: Record<string, object | string>): {
    sort(spec: { fetchedAt: 1 }): { lean(): Promise<DealPriceLeanDoc[]> };
  };
}

interface DealPriceSnapshotDocument {
  _id: string;
  gameKey: string;
  title: string;
  store: string;
  currency: string;
  price: number;
  fetchedAt: Date;
}

interface DealPriceHistoryDeps {
  DealPriceSnapshotModel: DealPriceSnapshotModelLike;
}

export interface DealPricePoint {
  price: number;
  at: Date;
}

export interface DealPriceHistorySummary {
  sampleCount: number;
  historicalMin: number | null;
  recentMedian: number | null;
  confidence: "low" | "medium" | "high";
}

const HOUR_MS = 60 * 60_000;

function numericPrice(value: PriceValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

function normalizeIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160);
}

export function dealPriceSeriesIdentity(deal: DealInfo, fallbackCurrency: string): { gameKey: string; store: string; currency: string } | null {
  const gameKey = normalizeIdentity(String(deal.appId ?? deal.steamAppID ?? deal.id ?? deal.title ?? ""));
  if (!gameKey) return null;
  return {
    gameKey,
    store: normalizeIdentity(String(deal.store || "unknown")) || "unknown",
    currency: String(deal.currency || fallbackCurrency).trim().toUpperCase()
  };
}

function snapshotId(identity: { gameKey: string; store: string; currency: string }, at: Date): string {
  return `${identity.gameKey}:${identity.store}:${identity.currency}:${Math.floor(at.getTime() / HOUR_MS)}`;
}

export function summarizeDealPriceHistory(points: readonly DealPricePoint[]): DealPriceHistorySummary {
  const prices = points.map(point => point.price).filter(price => Number.isFinite(price) && price >= 0).sort((left, right) => left - right);
  if (!prices.length) return { sampleCount: 0, historicalMin: null, recentMedian: null, confidence: "low" };
  const middle = Math.floor(prices.length / 2);
  const recentMedian = prices.length % 2 === 0 ? (prices[middle - 1] + prices[middle]) / 2 : prices[middle];
  return {
    sampleCount: prices.length,
    historicalMin: prices[0],
    recentMedian,
    confidence: prices.length >= 12 ? "high" : prices.length >= 3 ? "medium" : "low"
  };
}

export function createDealPriceHistoryService(deps: DealPriceHistoryDeps) {
  async function recordDealPriceSnapshots(deals: readonly DealInfo[], fallbackCurrency: string, at = new Date()): Promise<number> {
    const documents = deals.flatMap(deal => {
      const identity = dealPriceSeriesIdentity(deal, fallbackCurrency);
      const price = numericPrice(deal.salePrice);
      if (!identity || price === null || !identity.currency) return [];
      const document: DealPriceSnapshotDocument = {
        _id: snapshotId(identity, at),
        ...identity,
        title: String(deal.title || ""),
        price,
        fetchedAt: at
      };
      return [document];
    });
    if (!documents.length) return 0;
    await deps.DealPriceSnapshotModel.bulkWrite(documents.map(document => ({
      updateOne: {
        filter: { _id: document._id },
        update: { $set: document },
        upsert: true
      }
    })));
    return documents.length;
  }

  async function readDealPriceHistory(deal: DealInfo, fallbackCurrency: string, since: Date): Promise<DealPricePoint[]> {
    const identity = dealPriceSeriesIdentity(deal, fallbackCurrency);
    if (!identity) return [];
    const docs = await deps.DealPriceSnapshotModel
      .find({ ...identity, fetchedAt: { $gte: since } })
      .sort({ fetchedAt: 1 })
      .lean();
    return docs.flatMap(doc => {
      const at = new Date(doc.fetchedAt ?? Number.NaN);
      const price = Number(doc.price);
      return Number.isFinite(at.getTime()) && Number.isFinite(price) && price >= 0 ? [{ price, at }] : [];
    });
  }

  return { recordDealPriceSnapshots, readDealPriceHistory };
}

export default { createDealPriceHistoryService, dealPriceSeriesIdentity, summarizeDealPriceHistory };

export const DEAL_PRICE_HISTORY_KEYS = [
  "DealPriceSnapshotModel"
] as const;

type DealPriceHistoryKeyCheckDeps = Parameters<typeof createDealPriceHistoryService>[0];
type DealPriceHistoryMissing = MissingDependencyKeys<DealPriceHistoryKeyCheckDeps, (typeof DEAL_PRICE_HISTORY_KEYS)[number] & string>;
type DealPriceHistoryExtra = ExtraDependencyKeys<DealPriceHistoryKeyCheckDeps, (typeof DEAL_PRICE_HISTORY_KEYS)[number] & string>;
const dealpricehistoryKeysComplete: ExactDependencyKeys<MissingDependencyKeys<DealPriceHistoryKeyCheckDeps, (typeof DEAL_PRICE_HISTORY_KEYS)[number] & string>, DealPriceHistoryExtra> = true;
