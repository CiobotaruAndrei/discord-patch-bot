"use strict";

import type {
  DrainOutboxOptions,
  DrainOutboxResult,
  EnqueueOutboxJobInput,
  OutboxJob,
  OutboxRuntime,
  OutboxRuntimeDeps
} from "./outboxTypes.js";
import { isDeliverableOutboxPayload } from "./outboxTypes.js";
import { applyDedupeMarker, dedupeKeyFor, messageHasDedupeMarker, outboxDedupeMarker } from "./outboxDedupe.js";
import { createOutboxRepository } from "./outboxRepository.js";
import { backoffWithJitter, createOutboxStateMachine } from "./outboxStateMachine.js";
import { planNotificationFailure } from "./notificationFailurePolicy.js";
import { createOutboxDeliveryFinalizer } from "./outboxDeliveryFinalizer.js";

export type {
  DeliverResult,
  DiscountOutboxJob,
  DrainOutboxOptions,
  DrainOutboxResult,
  OutboxHistoryEntry,
  OutboxJob,
  OutboxKind,
  OutboxMessagePayload,
  OutboxRuntime,
  OutboxRuntimeDeps,
  UpdateOutboxJob,
  YouTubeOutboxJob
} from "./outboxTypes.js";

const DEFAULT_LEASE_MS = 60_000;

export function createOutboxRuntime({ NotificationOutboxModel, NotificationOutboxSentModel, withMongoRetry, logger }: OutboxRuntimeDeps): OutboxRuntime {
  const repository = createOutboxRepository({ NotificationOutboxModel, NotificationOutboxSentModel, withMongoRetry });

  async function enqueueOutbox(job: EnqueueOutboxJobInput): Promise<void> {
    if (!isDeliverableOutboxPayload(job.payload)) {
      logger("WARN", "OUTBOX", `Refuz enqueue pentru guild ${job.guildId} (${job.kind}): payload-ul nu e un obiect de mesaj livrabil`);
      throw new Error(`Payload outbox nelivrabil pentru ${job.kind} (guild ${job.guildId}); jobul a fost refuzat la enqueue`);
    }
    const dedupeKey = dedupeKeyFor(job);
    if (await repository.alreadySent(dedupeKey)) return;
    await repository.insertJob(job, dedupeKey, new Date());
  }

  async function drainOutbox(options: DrainOutboxOptions): Promise<DrainOutboxResult> {
    const nowFn = (): Date => options.now || new Date();
    const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    const workerId = options.workerId ?? "outbox-worker";

    let sent = 0;
    let deadLettered = 0;
    let retried = 0;
    let processed = 0;
    let deliveryMsTotal = 0;
    let recoveryDuplicates = 0;
    let recoveryFetches = 0;
    let recoveryFailures = 0;
    let recoveryMarkerMissing = 0;
    let markSentFailures = 0;
    let deliverErrors = 0;
    let expired = 0;
    let deleteFailures = 0;
    let deadLetterFailures = 0;
    let historyWriteFailures = 0;
    let droppedUnsubscribed = 0;
    const maxAgeMs = options.maxAgeMs ?? 0;

    const deleteJob = async (id: unknown): Promise<boolean> => {
      try {
        await repository.deleteJob(id);
        return true;
      } catch (err) {
        deleteFailures++;
        logger("WARN", "OUTBOX",
          `Stergerea jobului ${String(id)} a esuat dupa procesare (ramane in coada, va fi dedus/reluat la urmatorul ciclu)`,
          err instanceof Error ? err.message : String(err));
        return false;
      }
    };

    const recordDeadLetterOrKeep = async (job: OutboxJob, reason: string): Promise<boolean> => {
      const recorded = await options.recordDeadLetter(job, reason).then(() => true).catch(() => false);
      if (!recorded) {
        deadLetterFailures++;
        logger("WARN", "OUTBOX",
          `Audit-ul dead-letter (${reason}) pentru jobul ${String(job._id)} a esuat; NU sterg jobul (ramane in coada, reluat la urmatorul ciclu) ca sa nu pierd payload-ul de replay`);
      }
      return recorded;
    };

    const recordDeadLetterBeforeDelete = async (job: OutboxJob, reason: string): Promise<void> => {
      const recorded = await options.recordDeadLetter(job, reason).then(() => true).catch(() => false);
      if (!recorded) {
        deadLetterFailures++;
        logger("WARN", "OUTBOX",
          `Audit-ul dead-letter (${reason}) pentru jobul ${String(job._id)} a esuat; jobul a fost totusi sters fiindca mesajul era deja livrat (risc de dedupe degradat fara audit) - verifica disponibilitatea Mongo`);
      }
    };

    const retryOrDeadLetter = async (job: OutboxJob, reason: string, permanent: boolean): Promise<void> => {
      const verdict = planNotificationFailure(job.attempts, options.maxAttempts, permanent);
      if (verdict.action === "dead-letter") {
        if (!(await recordDeadLetterOrKeep(job, verdict.cause === "permanent" ? reason : "max-attempts"))) return;
        await deleteJob(job._id);
        deadLettered++;
        return;
      }
      await repository.scheduleRetry(job._id, verdict.attempts, new Date(nowFn().getTime() + backoffWithJitter(options.backoffMs, verdict.attempts)));
      retried++;
    };

    const stateMachine = createOutboxStateMachine({
      alreadySent: repository.alreadySent,
      isStillSubscribed: options.isStillSubscribed,
      maxAgeMs,
      now: nowFn,
      logger
    });

    const finalizer = createOutboxDeliveryFinalizer({
      deliver: options.deliver,
      recordSentHistory: options.recordSentHistory,
      markSent: repository.markSent,
      recordDeadLetterBeforeDelete,
      deleteJob,
      logger
    });

    for (let i = 0; i < options.limit; i++) {
      const job = await repository.claimNextJob(nowFn(), leaseMs, workerId);
      if (!job) break;
      processed++;

      const verdict = await stateMachine.validateClaimedJob(job);
      if (verdict.step === "drop-duplicate") {
        await deleteJob(job._id);
        continue;
      }
      if (verdict.step === "expire") {
        if (!(await recordDeadLetterOrKeep(job, "expired-near-ttl"))) continue;
        await deleteJob(job._id);
        expired++;
        continue;
      }
      if (verdict.step === "drop-unsubscribed") {
        await deleteJob(job._id);
        droppedUnsubscribed++;
        continue;
      }
      if (verdict.step === "retry") {
        await retryOrDeadLetter(job, verdict.reason, false);
        continue;
      }
      if (verdict.step === "dead-letter") {
        await retryOrDeadLetter(job, verdict.reason, true);
        continue;
      }

      const attempt = await finalizer.deliverClaimedJob(job);
      deliveryMsTotal += attempt.deliveryMs;
      if (attempt.threw) deliverErrors++;
      const result = attempt.result;
      if (result.ok) {
        const outcome = await finalizer.finalizeDeliveredJob(job, result);
        if (outcome.recoveryFetched) recoveryFetches++;
        if (outcome.recoveryDuplicate) recoveryDuplicates++;
        if (outcome.recoveryFailed) recoveryFailures++;
        if (outcome.recoveryMarkerMissing) recoveryMarkerMissing++;
        if (outcome.historyWriteFailed) historyWriteFailures++;
        if (outcome.markSentFailed) markSentFailures++;
        sent++;
        if (outcome.stopDrain) break;
        continue;
      }
      if (result.recoveryFailed) recoveryFailures++;
      await retryOrDeadLetter(job, "permanent", result.permanent);
    }

    if (maxAgeMs > 0) {
      const sweepNow = nowFn();
      const cutoff = new Date(sweepNow.getTime() - maxAgeMs);
      const staleJobs = await repository.findStaleJobs(cutoff, sweepNow, options.limit);
      for (const job of staleJobs) {
        if (!(await recordDeadLetterOrKeep(job, "expired-near-ttl"))) continue;
        let deletedCount: number;
        try {
          deletedCount = await repository.deleteStaleJobIfLeaseFree(job._id, sweepNow);
        } catch (err) {
          deleteFailures++;
          logger("WARN", "OUTBOX",
            `Stergerea (sweep TTL) jobului ${String(job._id)} a esuat (ramane in coada pana se reia; audit-ul dead-letter e deja scris)`,
            err instanceof Error ? err.message : String(err));
          continue;
        }
        if (deletedCount > 0) expired++;
      }
    }
    if (expired > 0) {
      logger("WARN", "OUTBOX", `Drain outbox: ${expired} job(uri) prea vechi mutate in dead-letter inainte de expirarea TTL (nelivrate dupa ${Math.round(maxAgeMs / 3600000)}h)`);
    }

    const queued = await repository.countQueued();
    const oldestAgeMs = await repository.oldestJobAgeMs(nowFn());
    const futureScheduled = await repository.futureScheduledCount(nowFn());

    if (sent || deadLettered || retried) {
      const errSuffix = deliverErrors > 0 ? `, ${deliverErrors} exceptii de livrare` : "";
      logger("INFO", "OUTBOX", `Drain outbox: ${sent} trimise, ${retried} reincercate, ${deadLettered} dead-letter, ${queued} ramase in coada${errSuffix}`);
    }
    if (deleteFailures > 0) {
      logger("WARN", "OUTBOX", `Drain outbox: ${deleteFailures} stergere(i) de job esuate (job-urile raman in coada si vor fi deduse/reluate)`);
    }
    if (deadLetterFailures > 0) {
      logger("WARN", "OUTBOX", `Drain outbox: ${deadLetterFailures} audit(uri) dead-letter esuate (job-urile terminale raman in coada pentru reluare; un job deja livrat e sters chiar fara audit - vezi log-urile WARN per job; verifica disponibilitatea Mongo)`);
    }
    return { sent, deadLettered, retried, expired, total: processed, queued, deliveryMsTotal, oldestJobAgeMs: oldestAgeMs, futureScheduledCount: futureScheduled, recoveryDuplicates, recoveryFetches, recoveryFailures, recoveryMarkerMissing, markSentFailures, deleteFailures, deadLetterFailures, historyWriteFailures, droppedUnsubscribed };
  }

  return { enqueueOutbox, drainOutbox };
}

export { applyDedupeMarker, isDeliverableOutboxPayload, messageHasDedupeMarker, outboxDedupeMarker };
