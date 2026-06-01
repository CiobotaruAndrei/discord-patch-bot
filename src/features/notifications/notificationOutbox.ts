"use strict";

export type OutboxKind = "update" | "discount";

export interface OutboxJob {
  _id?: unknown;
  guildId: string;
  channelId: string;
  kind: OutboxKind;
  payload: unknown;
  attempts: number;
}

interface OutboxModelLike {
  create(doc: Record<string, unknown>): Promise<unknown>;
  find(filter: unknown): { sort(spec: unknown): { limit(count: number): { lean(): Promise<OutboxJob[]> } } };
  deleteOne(filter: unknown): Promise<unknown>;
  updateOne(filter: unknown, update: unknown): Promise<unknown>;
  countDocuments(filter?: unknown): Promise<number>;
}

type WithMongoRetry = <T>(fn: () => Promise<T>, opts?: { label?: string; retries?: number }) => Promise<T>;
type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;

export interface OutboxRuntimeDeps {
  NotificationOutboxModel: OutboxModelLike;
  withMongoRetry: WithMongoRetry;
  logger: Logger;
}

export type DeliverResult = { ok: true } | { ok: false; permanent: boolean };

export interface DrainOutboxOptions {
  deliver: (job: OutboxJob) => Promise<DeliverResult>;
  recordDeadLetter: (job: OutboxJob, reason: string) => Promise<void>;
  maxAttempts: number;
  backoffMs: number;
  limit: number;
  now?: Date;
}

export interface DrainOutboxResult {
  sent: number;
  deadLettered: number;
  retried: number;
  total: number;
  queued: number;
}

export interface OutboxRuntime {
  enqueueOutbox(job: { guildId: string; channelId: string; kind: OutboxKind; payload: unknown }): Promise<void>;
  drainOutbox(options: DrainOutboxOptions): Promise<DrainOutboxResult>;
}

export function createOutboxRuntime({ NotificationOutboxModel, withMongoRetry, logger }: OutboxRuntimeDeps): OutboxRuntime {
  async function enqueueOutbox(job: { guildId: string; channelId: string; kind: OutboxKind; payload: unknown }): Promise<void> {
    await withMongoRetry(() => NotificationOutboxModel.create({
      guildId: job.guildId,
      channelId: job.channelId,
      kind: job.kind,
      payload: job.payload,
      attempts: 0,
      availableAt: new Date()
    }), { label: "enqueueOutbox" });
  }

  async function drainOutbox(options: DrainOutboxOptions): Promise<DrainOutboxResult> {
    const now = options.now || new Date();
    const due = await NotificationOutboxModel
      .find({ availableAt: { $lte: now } })
      .sort({ availableAt: 1 })
      .limit(options.limit)
      .lean();

    let sent = 0;
    let deadLettered = 0;
    let retried = 0;

    for (const job of due) {
      const result = await options.deliver(job);
      if (result.ok) {
        await NotificationOutboxModel.deleteOne({ _id: job._id });
        sent++;
        continue;
      }
      const attempts = (job.attempts || 0) + 1;
      if (result.permanent || attempts >= options.maxAttempts) {
        await options.recordDeadLetter(job, result.permanent ? "permanent" : "max-attempts").catch(() => undefined);
        await NotificationOutboxModel.deleteOne({ _id: job._id });
        deadLettered++;
        continue;
      }
      await NotificationOutboxModel.updateOne(
        { _id: job._id },
        { $set: { attempts, availableAt: new Date(now.getTime() + options.backoffMs * attempts) } }
      );
      retried++;
    }

    const queued = await NotificationOutboxModel.countDocuments({}).catch(() => 0);

    if (sent || deadLettered || retried) {
      logger("INFO", "OUTBOX", `Drain outbox: ${sent} trimise, ${retried} reincercate, ${deadLettered} dead-letter, ${queued} ramase in coada`);
    }
    return { sent, deadLettered, retried, total: due.length, queued };
  }

  return { enqueueOutbox, drainOutbox };
}
