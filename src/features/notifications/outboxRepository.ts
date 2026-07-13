"use strict";

import type { EnqueueOutboxJobInput, OutboxJob, OutboxRuntimeDeps } from "./outboxTypes.js";

export function createOutboxRepository({ NotificationOutboxModel, NotificationOutboxSentModel, withMongoRetry }: Omit<OutboxRuntimeDeps, "logger">) {
  async function alreadySent(dedupeKey: string): Promise<boolean> {
    return Boolean(await NotificationOutboxSentModel.exists({ dedupeKey }).catch(() => null));
  }

  async function insertJob(job: EnqueueOutboxJobInput, dedupeKey: string, at: Date): Promise<void> {
    try {
      await withMongoRetry(() => NotificationOutboxModel.create({
        guildId: job.guildId,
        channelId: job.channelId,
        kind: job.kind,
        payload: job.payload,
        attempts: 0,
        dedupeKey,
        recoveryVerify: job.recoveryVerify,
        manual: job.manual === true,
        history: job.history || [],
        createdAt: at,
        availableAt: job.availableAt && job.availableAt.getTime() > at.getTime() ? job.availableAt : at
      }), { label: "enqueueOutbox" });
    } catch (err) {
      if ((err as { code?: number } | null)?.code === 11000) return;
      throw err;
    }
  }

  async function markSent(dedupeKey: string | undefined): Promise<boolean> {
    if (!dedupeKey) return true;
    try {
      await withMongoRetry(
        () => NotificationOutboxSentModel.updateOne(
          { dedupeKey },
          { $setOnInsert: { dedupeKey, sentAt: new Date() } },
          { upsert: true }
        ),
        { label: "outboxMarkSent" }
      );
      return true;
    } catch {
      return false;
    }
  }

  const ACTIVE_STATUS_FILTER = { $or: [{ status: { $in: ["queued", "leased"] } }, { status: { $exists: false } }] };

  function claimNextJob(now: Date, leaseMs: number, workerId: string): Promise<OutboxJob | null> {
    return NotificationOutboxModel.findOneAndUpdate(
      {
        availableAt: { $lte: now },
        $and: [
          ACTIVE_STATUS_FILTER,
          { $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: null }, { lockedUntil: { $lte: now } }] }
        ]
      },
      {
        $set: { lockedUntil: new Date(now.getTime() + leaseMs), lockedBy: workerId, status: "leased", statusChangedAt: now },
        $inc: { deliveries: 1 }
      },
      { sort: { availableAt: 1 }, new: true }
    );
  }

  async function deleteJob(id: unknown): Promise<void> {
    await NotificationOutboxModel.deleteOne({ _id: id });
  }

  async function finalizeJob(id: unknown, status: "delivered" | "dead-lettered" | "dropped", now: Date): Promise<void> {
    await NotificationOutboxModel.updateOne(
      { _id: id },
      {
        $set: { status, statusChangedAt: now },
        $unset: { lockedUntil: "", lockedBy: "" }
      }
    );
  }

  async function scheduleRetry(id: unknown, attempts: number, availableAt: Date): Promise<void> {
    await NotificationOutboxModel.updateOne(
      { _id: id },
      {
        $set: { attempts, availableAt, status: "queued", statusChangedAt: new Date() },
        $unset: { lockedUntil: "", lockedBy: "" }
      }
    );
  }

  async function oldestJobAgeMs(now: Date): Promise<number> {
    const rows = await NotificationOutboxModel.find({ availableAt: { $lte: now }, ...ACTIVE_STATUS_FILTER }).sort({ availableAt: 1 }).limit(1).lean().catch(() => [] as OutboxJob[]);
    const oldest = Array.isArray(rows) ? rows[0] : undefined;
    const stamp = oldest?.availableAt ?? oldest?.createdAt;
    if (!stamp) return 0;
    return Math.max(0, now.getTime() - new Date(stamp).getTime());
  }

  async function futureScheduledCount(now: Date): Promise<number> {
    return NotificationOutboxModel.countDocuments({ availableAt: { $gt: now }, ...ACTIVE_STATUS_FILTER }).catch(() => 0);
  }

  async function countQueued(): Promise<number> {
    return NotificationOutboxModel.countDocuments(ACTIVE_STATUS_FILTER).catch(() => 0);
  }

  function leaseFreeFilter(sweepNow: Date): { $or: Array<Record<string, unknown>> } {
    return { $or: [{ lockedUntil: null }, { lockedUntil: { $lte: sweepNow } }] };
  }

  async function findStaleJobs(cutoff: Date, sweepNow: Date, limit: number): Promise<OutboxJob[]> {
    const staleJobs = await NotificationOutboxModel.find({ createdAt: { $lte: cutoff }, $and: [ACTIVE_STATUS_FILTER, leaseFreeFilter(sweepNow)] })
      .sort({ createdAt: 1 }).limit(limit).lean().catch(() => [] as OutboxJob[]);
    return Array.isArray(staleJobs) ? staleJobs : [];
  }

  async function deleteStaleJobIfLeaseFree(id: unknown, sweepNow: Date): Promise<number> {
    const del = await NotificationOutboxModel.deleteOne({ _id: id, ...leaseFreeFilter(sweepNow) });
    return (del as { deletedCount?: number })?.deletedCount ?? 0;
  }

  return {
    alreadySent,
    insertJob,
    markSent,
    claimNextJob,
    deleteJob,
    finalizeJob,
    scheduleRetry,
    oldestJobAgeMs,
    futureScheduledCount,
    countQueued,
    findStaleJobs,
    deleteStaleJobIfLeaseFree
  };
}

export type OutboxRepository = ReturnType<typeof createOutboxRepository>;
