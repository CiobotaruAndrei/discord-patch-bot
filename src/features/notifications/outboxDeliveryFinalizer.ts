"use strict";

import type { DeliverResult, OutboxHistoryEntry, OutboxJob, OutboxLogger } from "./outboxTypes.js";

import { errorMessage } from "../../shared/errors.js";

export interface OutboxDeliveryFinalizerDeps {
  deliver(job: OutboxJob): Promise<DeliverResult>;
  recordSentHistory?: (guildId: string, entries: OutboxHistoryEntry[]) => Promise<void>;
  markSent(dedupeKey: string | undefined): Promise<boolean>;
  recordDeadLetterBeforeDelete(job: OutboxJob, reason: string): Promise<void>;
  finalizeDelivered(id: unknown): Promise<boolean>;
  logger: OutboxLogger;
}

export interface DeliveryAttemptOutcome {
  result: DeliverResult;
  deliveryMs: number;
  threw: boolean;
}

export interface FinalizeOutcome {
  stopDrain: boolean;
  markSentFailed: boolean;
  historyWriteFailed: boolean;
  recoveryFetched: boolean;
  recoveryDuplicate: boolean;
  recoveryFailed: boolean;
  recoveryMarkerMissing: boolean;
}

export function createOutboxDeliveryFinalizer({ deliver, recordSentHistory, markSent, recordDeadLetterBeforeDelete, finalizeDelivered, logger }: OutboxDeliveryFinalizerDeps) {
  async function deliverClaimedJob(job: OutboxJob): Promise<DeliveryAttemptOutcome> {
    const startedAt = Date.now();
    let result: DeliverResult;
    let threw = false;
    try {
      result = await deliver(job);
    } catch (err) {
      logger("WARN", "OUTBOX",
        `Livrarea jobului ${String(job._id)} a aruncat o exceptie (tratata ca esec tranzitoriu)`,
        err instanceof Error ? err.message : String(err));
      threw = true;
      result = { ok: false, permanent: false };
    }
    return { result, deliveryMs: Math.max(0, Date.now() - startedAt), threw };
  }

  async function finalizeDeliveredJob(job: OutboxJob, result: Extract<DeliverResult, { ok: true }>): Promise<FinalizeOutcome> {
    let historyWriteFailed = false;
    if (recordSentHistory && Array.isArray(job.history) && job.history.length) {
      await recordSentHistory(job.guildId, job.history).catch((err: unknown) => {
        historyWriteFailed = true;
        logger("WARN", "OUTBOX", `Scrierea istoricului /history a esuat pentru un job livrat (guild ${job.guildId}); livrarea a reusit, dar /history poate fi incomplet`, errorMessage(err));
      });
    }
    const markSentFailed = job.dedupeKey ? !(await markSent(job.dedupeKey)) : false;
    if (markSentFailed) {
      await recordDeadLetterBeforeDelete(job, "delivered-marksent-failed");
    }
    await finalizeDelivered(job._id);
    return {
      stopDrain: markSentFailed,
      markSentFailed,
      historyWriteFailed,
      recoveryFetched: result.recoveryFetched === true,
      recoveryDuplicate: result.recoveryDuplicate === true,
      recoveryFailed: result.recoveryFailed === true,
      recoveryMarkerMissing: result.recoveryMarkerMissing === true
    };
  }

  return { deliverClaimedJob, finalizeDeliveredJob };
}

export type OutboxDeliveryFinalizer = ReturnType<typeof createOutboxDeliveryFinalizer>;
