"use strict";

import { fitDeliveryMessage } from "./auditLogView.js";

export type ScheduledAuditBatch = { cancel(): void };

export type AuditBatchScheduler = (task: () => Promise<void>, delayMs: number) => ScheduledAuditBatch;

export type AuditBatchPage = { rendered: string; visibleCount: number; hasMore: boolean };

export type AuditBatchStop = "no-follow-up" | "expired" | "failed";

export type AuditBatchDeliveryDeps = {
  header: string;
  batchSize: number;
  maxBatches: number;
  intervalMs: number;
  fetchPage: (offset: number, size: number) => Promise<AuditBatchPage>;
  sendInitial: (content: string) => Promise<unknown>;
  sendFollowUp: ((content: string) => Promise<unknown>) | null;
  schedule: AuditBatchScheduler;
  onStopped: (reason: AuditBatchStop, batchNumber: number, error?: unknown) => void;
};

export type AuditBatchDelivery = { cancel(): boolean };

export function batchStatusLine(
  batchNumber: number,
  visibleCount: number,
  hasMore: boolean,
  reachedBudget: boolean,
  batchSize: number
): string {
  if (reachedBudget) {
    return `Livrare oprita dupa ${batchNumber * batchSize} intrari: intervalul depaseste fereastra sigura a tokenului Discord. Alege un interval mai mic.`;
  }
  return hasMore
    ? `Lot ${batchNumber}: ${visibleCount} intrari. Urmatorul lot va fi trimis automat.`
    : `Livrare finalizata: lot ${batchNumber}, ${visibleCount} intrari.`;
}

export function defaultAuditBatchScheduler(task: () => Promise<void>, delayMs: number): ScheduledAuditBatch {
  const timer = setTimeout(() => { void task(); }, delayMs);
  timer.unref?.();
  return { cancel: () => clearTimeout(timer) };
}

export async function deliverAuditBatches(
  deps: AuditBatchDeliveryDeps,
  initialOffset: number
): Promise<AuditBatchDelivery> {
  let pending: ScheduledAuditBatch | null = null;

  function cancel(): boolean {
    if (!pending) return false;
    pending.cancel();
    pending = null;
    return true;
  }

  async function deliver(batchNumber: number, offset: number, initial: boolean): Promise<void> {
    const page = await deps.fetchPage(offset, deps.batchSize);
    const reachedBudget = page.hasMore && batchNumber >= deps.maxBatches;
    const status = batchStatusLine(batchNumber, page.visibleCount, page.hasMore, reachedBudget, deps.batchSize);
    const content = fitDeliveryMessage(deps.header, page.rendered, status);

    if (initial) {
      await deps.sendInitial(content);
    } else if (!deps.sendFollowUp) {
      deps.onStopped("no-follow-up", batchNumber);
      pending = null;
      return;
    } else {
      try {
        await deps.sendFollowUp(content);
      } catch (error: unknown) {
        deps.onStopped("expired", batchNumber, error);
        pending = null;
        return;
      }
    }

    if (!page.hasMore || reachedBudget) {
      pending = null;
      return;
    }

    pending = deps.schedule(async () => {
      pending = null;
      try {
        await deliver(batchNumber + 1, offset + deps.batchSize, false);
      } catch (error: unknown) {
        deps.onStopped("failed", batchNumber + 1, error);
      }
    }, deps.intervalMs);
  }

  await deliver(1, initialOffset, true);
  return { cancel };
}
