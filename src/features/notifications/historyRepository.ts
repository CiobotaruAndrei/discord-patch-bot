import crypto from "crypto";
import type { MongoFilter, MongoProjection, MongoQueryOptions } from "../../infra/mongo/mongoQueryShapes.js";

type WithMongoRetry = <T>(fn: () => Promise<T>, opts?: { label?: string; retries?: number }) => Promise<T>;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

export type NotificationKind = "update" | "discount" | "youtube";

export interface NotificationHistoryEntry {
  kind: NotificationKind;
  gameKey?: string;
  title?: string;
  link?: string;
  itemId?: string;
}

export interface NotificationHistoryDoc {
  guildId: string;
  kind: NotificationKind;
  gameKey: string;
  title: string;
  link: string;
  dedupeKey: string;
  sentAt: Date;
}

export interface NotificationHistoryRecord {
  kind: NotificationKind;
  gameKey: string;
  title: string;
  link: string;
  sentAt: Date;
}

interface NotificationHistoryModelLike {
  insertMany(docs: unknown[], opts?: MongoQueryOptions): Promise<unknown>;
  bulkWrite(ops: unknown[], opts?: MongoQueryOptions): Promise<unknown>;
  find(filter: MongoFilter, projection?: MongoProjection): {
    sort(spec: unknown): { limit(count: number): { lean(): Promise<Array<Record<string, unknown>>> } };
  };
}

export interface HistoryRepositoryDeps {
  NotificationHistoryModel: NotificationHistoryModelLike;
  withMongoRetry: WithMongoRetry;
  logger: Logger;
}

export interface HistoryRepository {
  recordSent(guildId: string, entries: NotificationHistoryEntry[]): Promise<void>;
  getRecent(guildId: string, kind: NotificationKind | "all", limit: number): Promise<NotificationHistoryRecord[]>;
}

type HistoryEntryLike = { kind?: unknown; gameKey?: unknown; title?: unknown; link?: unknown; itemId?: unknown };

export const HISTORY_DEDUPE_VERSION = "history:v1";

export function buildHistoryDedupeKey(kind: NotificationKind, gameKey: string, link: string, title: string, itemId: string): string {
  if (!itemId && !link && !title) return "";
  const digest = crypto.createHash("sha256").update(JSON.stringify([kind, gameKey, link, title, itemId])).digest("hex");
  return `${HISTORY_DEDUPE_VERSION}:${digest}`;
}

export function sanitizeHistoryDocs(guildId: string, entries: ReadonlyArray<HistoryEntryLike | null | undefined>, now: Date): NotificationHistoryDoc[] {
  const docs: NotificationHistoryDoc[] = [];
  for (const entry of entries || []) {
    if (!entry || (entry.kind !== "update" && entry.kind !== "discount" && entry.kind !== "youtube")) continue;
    const gameKey = String(entry.gameKey || "").slice(0, 100);
    const title = String(entry.title || "").slice(0, 300);
    const link = String(entry.link || "").slice(0, 500);
    const itemId = String(entry.itemId || "").slice(0, 300);
    docs.push({
      guildId,
      kind: entry.kind,
      gameKey,
      title,
      link,
      dedupeKey: buildHistoryDedupeKey(entry.kind, gameKey, link, title, itemId),
      sentAt: now
    });
  }
  return docs;
}

export function clampHistoryLimit(limit: number): number {
  return Math.min(25, Math.max(1, Math.floor(limit) || 10));
}

export function createHistoryRepository(deps: HistoryRepositoryDeps): HistoryRepository {
  const { NotificationHistoryModel, withMongoRetry, logger } = deps;

  async function recordSent(guildId: string, entries: NotificationHistoryEntry[]): Promise<void> {
    const docs = sanitizeHistoryDocs(guildId, entries, new Date());
    if (docs.length === 0) return;
    const keyed = docs.filter(doc => doc.dedupeKey);
    const unkeyed = docs.filter(doc => !doc.dedupeKey);
    try {
      if (keyed.length > 0) {
        const ops = keyed.map(doc => ({
          updateOne: {
            filter: { guildId: doc.guildId, dedupeKey: doc.dedupeKey },
            update: { $setOnInsert: doc },
            upsert: true
          }
        }));
        await withMongoRetry(() => NotificationHistoryModel.bulkWrite(ops, { ordered: false }), { label: "history:record", retries: 1 });
      }
      if (unkeyed.length > 0) {
        await withMongoRetry(() => NotificationHistoryModel.insertMany(unkeyed, { ordered: false }), { label: "history:record-unkeyed", retries: 1 });
      }
    } catch (err) {
      logger("WARN", "HISTORY", "Nu am putut scrie istoricul notificarilor (best-effort, livrarea nu e afectata)", err);
    }
  }

  async function getRecent(guildId: string, kind: NotificationKind | "all", limit: number): Promise<NotificationHistoryRecord[]> {
    const filter = kind === "all" ? { guildId } : { guildId, kind };
    const safeLimit = clampHistoryLimit(limit);
    const docs = await withMongoRetry(
      () => NotificationHistoryModel.find(filter, { kind: 1, gameKey: 1, title: 1, link: 1, sentAt: 1 }).sort({ sentAt: -1 }).limit(safeLimit).lean(),
      { label: "history:getRecent" }
    );
    return docs.map(doc => ({
      kind: doc.kind === "discount" ? "discount" : doc.kind === "youtube" ? "youtube" : "update",
      gameKey: String(doc.gameKey || ""),
      title: String(doc.title || ""),
      link: String(doc.link || ""),
      sentAt: doc.sentAt instanceof Date ? doc.sentAt : new Date(String(doc.sentAt))
    }));
  }

  return { recordSent, getRecent };
}
