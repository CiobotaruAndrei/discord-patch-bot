"use strict";

export type OutboxKind = "update" | "discount" | "youtube";

export interface OutboxHistoryEntry {
  kind: OutboxKind;
  gameKey?: string;
  title?: string;
  link?: string;
  itemId?: string;
}

interface OutboxJobBase {
  _id?: unknown;
  guildId: string;
  channelId: string;
  payload: unknown;
  attempts: number;
  deliveries?: number;
  dedupeKey?: string;
  recoveryVerify?: boolean;
  manual?: boolean;
  history?: OutboxHistoryEntry[];
  createdAt?: Date;
  availableAt?: Date;
}

export interface UpdateOutboxJob extends OutboxJobBase { kind: "update" }
export interface DiscountOutboxJob extends OutboxJobBase { kind: "discount" }
export interface YouTubeOutboxJob extends OutboxJobBase { kind: "youtube" }

export type OutboxJob = UpdateOutboxJob | DiscountOutboxJob | YouTubeOutboxJob;

export interface OutboxMessagePayload {
  content?: string;
  embeds?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export function isDeliverableOutboxPayload(payload: unknown): payload is OutboxMessagePayload {
  return Boolean(payload) && typeof payload === "object" && !Array.isArray(payload);
}

export interface OutboxModelLike {
  create(doc: Record<string, unknown>): Promise<unknown>;
  find(filter: unknown): { sort(spec: unknown): { limit(count: number): { lean(): Promise<OutboxJob[]> } } };
  findOneAndUpdate(filter: unknown, update: unknown, opts?: unknown): Promise<OutboxJob | null>;
  deleteOne(filter: unknown): Promise<unknown>;
  updateOne(filter: unknown, update: unknown): Promise<unknown>;
  countDocuments(filter?: unknown): Promise<number>;
}

export interface OutboxSentModelLike {
  exists(filter: unknown): Promise<unknown>;
  updateOne(filter: unknown, update: unknown, opts?: unknown): Promise<unknown>;
}

export type WithMongoRetry = <T>(fn: () => Promise<T>, opts?: { label?: string; retries?: number }) => Promise<T>;
export type OutboxLogger = (level: string, context: string, msg: string, meta?: unknown) => void;

export interface OutboxRuntimeDeps {
  NotificationOutboxModel: OutboxModelLike;
  NotificationOutboxSentModel: OutboxSentModelLike;
  withMongoRetry: WithMongoRetry;
  logger: OutboxLogger;
}

export type DeliverResult =
  | { ok: true; recoveryFetched?: boolean; recoveryDuplicate?: boolean; recoveryFailed?: boolean; recoveryMarkerMissing?: boolean }
  | { ok: false; permanent: boolean; recoveryFailed?: boolean };

export interface DrainOutboxOptions {
  deliver: (job: OutboxJob) => Promise<DeliverResult>;
  isStillSubscribed?: (job: OutboxJob) => Promise<boolean>;
  recordDeadLetter: (job: OutboxJob, reason: string) => Promise<void>;
  recordSentHistory?: (guildId: string, entries: OutboxHistoryEntry[]) => Promise<void>;
  maxAttempts: number;
  backoffMs: number;
  limit: number;
  leaseMs?: number;
  workerId?: string;
  now?: Date;
  maxAgeMs?: number;
}

export interface DrainOutboxResult {
  sent: number;
  deadLettered: number;
  retried: number;
  expired: number;
  total: number;
  queued: number;
  deliveryMsTotal: number;
  oldestJobAgeMs: number;
  futureScheduledCount: number;
  recoveryDuplicates: number;
  recoveryFetches: number;
  recoveryFailures: number;
  recoveryMarkerMissing: number;
  markSentFailures: number;
  deleteFailures: number;
  deadLetterFailures: number;
  historyWriteFailures: number;
  droppedUnsubscribed: number;
}

export interface EnqueueOutboxJobInput {
  guildId: string;
  channelId: string;
  kind: OutboxKind;
  payload: unknown;
  recoveryVerify?: boolean;
  manual?: boolean;
  history?: OutboxHistoryEntry[];
  availableAt?: Date;
}

export interface OutboxRuntime {
  enqueueOutbox(job: EnqueueOutboxJobInput): Promise<void>;
  drainOutbox(options: DrainOutboxOptions): Promise<DrainOutboxResult>;
}
