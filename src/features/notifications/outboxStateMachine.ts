"use strict";

import type { OutboxJob, OutboxLogger } from "./outboxTypes";
import { isDeliverableOutboxPayload } from "./outboxTypes";

const MAX_BACKOFF_MS = 30 * 60 * 1000;

export function backoffWithJitter(baseMs: number, attempts: number): number {
  const capped = Math.min(baseMs * attempts, MAX_BACKOFF_MS);
  return Math.round(capped * (0.5 + Math.random()));
}

export type OutboxJobVerdict =
  | { step: "deliver" }
  | { step: "drop-duplicate" }
  | { step: "expire" }
  | { step: "drop-unsubscribed" }
  | { step: "retry"; reason: string }
  | { step: "dead-letter"; reason: string };

export interface OutboxStateMachineDeps {
  alreadySent(dedupeKey: string): Promise<boolean>;
  isStillSubscribed?: (job: OutboxJob) => Promise<boolean>;
  maxAgeMs: number;
  now(): Date;
  logger: OutboxLogger;
}

export function createOutboxStateMachine({ alreadySent, isStillSubscribed, maxAgeMs, now, logger }: OutboxStateMachineDeps) {
  async function validateClaimedJob(job: OutboxJob): Promise<OutboxJobVerdict> {
    if (job.dedupeKey && await alreadySent(job.dedupeKey)) {
      return { step: "drop-duplicate" };
    }
    if (maxAgeMs > 0 && job.createdAt && new Date(job.createdAt).getTime() <= now().getTime() - maxAgeMs) {
      return { step: "expire" };
    }
    if (isStillSubscribed) {
      let stillSubscribed: boolean;
      try {
        stillSubscribed = await isStillSubscribed(job);
      } catch (err) {
        logger("WARN", "OUTBOX",
          `Verificarea abonarii pentru jobul ${String(job._id)} a esuat; aman livrarea ca sa nu trimit intr-un canal dezabonat`,
          err instanceof Error ? err.message : String(err));
        return { step: "retry", reason: "subscription-check-failed" };
      }
      if (!stillSubscribed) return { step: "drop-unsubscribed" };
    }
    if (!isDeliverableOutboxPayload(job.payload)) {
      logger("WARN", "OUTBOX",
        `Payload-ul jobului ${String(job._id)} nu e livrabil (fara content/embeds valide); il mut in dead-letter ca sa nu ocupe coada`);
      return { step: "dead-letter", reason: "invalid-payload" };
    }
    return { step: "deliver" };
  }

  return { validateClaimedJob };
}

export type OutboxStateMachine = ReturnType<typeof createOutboxStateMachine>;
