type WithMongoRetry = <T>(fn: () => Promise<T>, opts?: { label?: string; retries?: number }) => Promise<T>;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

export type NotificationKind = "update" | "discount";

export interface NotificationHistoryEntry {
  kind: NotificationKind;
  gameKey?: string;
  title?: string;
  link?: string;
}

export interface NotificationHistoryDoc {
  guildId: string;
  kind: NotificationKind;
  gameKey: string;
  title: string;
  link: string;
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
  insertMany(docs: unknown[], opts?: unknown): Promise<unknown>;
  find(filter: unknown, projection?: unknown): {
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

type HistoryEntryLike = { kind?: unknown; gameKey?: unknown; title?: unknown; link?: unknown };

export function sanitizeHistoryDocs(guildId: string, entries: ReadonlyArray<HistoryEntryLike | null | undefined>, now: Date): NotificationHistoryDoc[] {
  const docs: NotificationHistoryDoc[] = [];
  for (const entry of entries || []) {
    if (!entry || (entry.kind !== "update" && entry.kind !== "discount")) continue;
    docs.push({
      guildId,
      kind: entry.kind,
      gameKey: String(entry.gameKey || "").slice(0, 100),
      title: String(entry.title || "").slice(0, 300),
      link: String(entry.link || "").slice(0, 500),
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
    try {
      await withMongoRetry(() => NotificationHistoryModel.insertMany(docs, { ordered: false }), { label: "history:record", retries: 1 });
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
      kind: doc.kind === "discount" ? "discount" : "update",
      gameKey: String(doc.gameKey || ""),
      title: String(doc.title || ""),
      link: String(doc.link || ""),
      sentAt: doc.sentAt instanceof Date ? doc.sentAt : new Date(String(doc.sentAt))
    }));
  }

  return { recordSent, getRecent };
}
