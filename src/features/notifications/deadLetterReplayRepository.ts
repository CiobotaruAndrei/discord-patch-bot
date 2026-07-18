type MongoFilter = Record<string, unknown>;
type MongoUpdate = Record<string, unknown>;
type MongoProjection = Record<string, unknown>;
type MongoQueryOptions = Record<string, unknown>;
type WithMongoRetry = <T>(fn: () => Promise<T>, opts?: { label?: string; retries?: number }) => Promise<T>;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

export type ReplayKind = "update" | "discount" | "youtube" | "future-release";

export interface ReplayHistoryEntry {
  kind: ReplayKind;
  gameKey?: string;
  title?: string;
  link?: string;
  itemId?: string;
}

export interface ReplayPayloadInput {
  guildId: string;
  kind: ReplayKind;
  channelId: string;
  payload: unknown;
  dedupeKey?: string;
  recoveryVerify?: boolean;
  reason: string;
  itemId?: string;
  history?: ReplayHistoryEntry[];
}

export interface ReplayPayloadDoc {
  _id: unknown;
  kind: ReplayKind;
  channelId: string;
  payload: unknown;
  dedupeKey: string;
  recoveryVerify: boolean;
  history: ReplayHistoryEntry[];
}

interface ReplayModelLike {
  create(doc: Record<string, unknown>): Promise<unknown>;
  updateOne(filter: MongoFilter, update: MongoUpdate, opts?: MongoQueryOptions): Promise<unknown>;
  find(filter: MongoFilter, projection?: MongoProjection): {
    sort(spec: unknown): { limit(count: number): { lean(): Promise<Array<Record<string, unknown>>> } };
  };
  deleteMany(filter: MongoFilter): Promise<unknown>;
}

export interface DeadLetterReplayRepositoryDeps {
  NotificationDeadLetterReplayModel: ReplayModelLike;
  withMongoRetry: WithMongoRetry;
  logger: Logger;
  limit?: number;
}

export interface DeadLetterReplayRepository {
  recordPayload(input: ReplayPayloadInput): Promise<void>;
  listForGuild(guildId: string): Promise<ReplayPayloadDoc[]>;
  deleteReplayed(guildId: string, ids: unknown[]): Promise<void>;
  deleteAllForGuild(guildId: string): Promise<void>;
}

const NON_REPLAYABLE_REASONS = new Set(["delivered-marksent-failed"]);
const DEFAULT_REPLAY_LIMIT = 50;

export function isReplayableReason(reason: string): boolean {
  return Boolean(reason) && !NON_REPLAYABLE_REASONS.has(reason);
}

function normalizeHistory(raw: unknown): ReplayHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ReplayHistoryEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const fields = entry as Record<string, unknown>;
    const kind: ReplayKind = fields.kind === "discount" ? "discount" : fields.kind === "youtube" ? "youtube" : fields.kind === "future-release" ? "future-release" : "update";
    out.push({
      kind,
      gameKey: typeof fields.gameKey === "string" ? fields.gameKey : undefined,
      title: typeof fields.title === "string" ? fields.title : undefined,
      link: typeof fields.link === "string" ? fields.link : undefined,
      itemId: typeof fields.itemId === "string" ? fields.itemId : undefined
    });
  }
  return out;
}

export function createDeadLetterReplayRepository(deps: DeadLetterReplayRepositoryDeps): DeadLetterReplayRepository {
  const { NotificationDeadLetterReplayModel, withMongoRetry, logger } = deps;
  const limit = Math.min(200, Math.max(1, deps.limit ?? DEFAULT_REPLAY_LIMIT));

  async function recordPayload(input: ReplayPayloadInput): Promise<void> {
    if (!isReplayableReason(input.reason)) return;
    if (input.payload === undefined || input.payload === null) return;
    if (!input.channelId) return;
    const dedupeKey = input.dedupeKey || "";
    const fields = {
      guildId: input.guildId,
      kind: input.kind,
      channelId: input.channelId,
      payload: input.payload,
      dedupeKey,
      recoveryVerify: input.recoveryVerify === true,
      reason: input.reason,
      itemId: input.itemId || "",
      history: Array.isArray(input.history) ? input.history : []
    };
    const now = new Date();
    try {
      if (dedupeKey) {
        await withMongoRetry(() => NotificationDeadLetterReplayModel.updateOne(
          { guildId: input.guildId, dedupeKey },
          { $set: { ...fields, updatedAt: now }, $setOnInsert: { createdAt: now } },
          { upsert: true }
        ), { label: "deadLetterReplay:record", retries: 1 });
      } else {
        await withMongoRetry(() => NotificationDeadLetterReplayModel.create({ ...fields, createdAt: now, updatedAt: now }), { label: "deadLetterReplay:record", retries: 1 });
      }
    } catch (err) {
      logger("WARN", "OUTBOX", "Nu am putut salva payload-ul pentru replay dead-letter (best-effort)", err);
    }
  }

  async function listForGuild(guildId: string): Promise<ReplayPayloadDoc[]> {
    const docs = await withMongoRetry(
      () => NotificationDeadLetterReplayModel.find({ guildId }, { kind: 1, channelId: 1, payload: 1, dedupeKey: 1, recoveryVerify: 1, history: 1 }).sort({ createdAt: 1 }).limit(limit).lean(),
      { label: "deadLetterReplay:list" }
    );
    return docs.map(doc => ({
      _id: doc._id,
      kind: doc.kind === "discount" ? "discount" : doc.kind === "youtube" ? "youtube" : doc.kind === "future-release" ? "future-release" : "update",
      channelId: String(doc.channelId || ""),
      payload: doc.payload,
      dedupeKey: String(doc.dedupeKey || ""),
      recoveryVerify: doc.recoveryVerify === true,
      history: normalizeHistory(doc.history)
    }));
  }

  async function deleteReplayed(guildId: string, ids: unknown[]): Promise<void> {
    if (!ids.length) return;
    await withMongoRetry(() => NotificationDeadLetterReplayModel.deleteMany({ guildId, _id: { $in: ids } }), { label: "deadLetterReplay:delete" });
  }

  async function deleteAllForGuild(guildId: string): Promise<void> {
    await withMongoRetry(() => NotificationDeadLetterReplayModel.deleteMany({ guildId }), { label: "deadLetterReplay:deleteAll" });
  }

  return { recordPayload, listForGuild, deleteReplayed, deleteAllForGuild };
}
