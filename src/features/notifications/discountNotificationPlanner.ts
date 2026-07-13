"use strict";

import type { DealInfo, PendingDiscount, ValidatedDealInfo } from "../../types.js";
import { planNotificationFailure } from "./notificationFailurePolicy.js";

export interface DealsHashIndex {
  dealsByHash: Map<string, DealInfo>;
  orderedHashes: string[];
}

export function buildDealsHashIndex(deals: DealInfo[], dealHash: (deal: DealInfo) => string): DealsHashIndex {
  const dealsByHash = new Map<string, DealInfo>();
  const orderedHashes: string[] = [];
  for (const deal of deals) {
    const hash = dealHash(deal);
    if (!dealsByHash.has(hash)) {
      dealsByHash.set(hash, deal);
      orderedHashes.push(hash);
    }
  }
  return { dealsByHash, orderedHashes };
}

export interface PlanPendingDiscountsInput {
  oldPending: PendingDiscount[];
  orderedHashes: string[];
  dealsByHash: Map<string, DealInfo>;
  seenSet: Set<string>;
  now: Date;
  maxAttempts: number;
  graceCycles: number;
  limit: number;
  passesFilters: (deal: DealInfo) => boolean;
  validateSnapshot: (snapshot: unknown) => snapshot is ValidatedDealInfo;
}

export function planPendingDiscounts(input: PlanPendingDiscountsInput): PendingDiscount[] {
  const { oldPending, orderedHashes, dealsByHash, seenSet, now, maxAttempts, graceCycles, limit, passesFilters, validateSnapshot } = input;
  const pending: PendingDiscount[] = [];
  for (const old of oldPending) {
    if (seenSet.has(old.hash) || (old.attempts ?? 0) >= maxAttempts) continue;
    const fresh = dealsByHash.get(old.hash);
    if (fresh) {
      if (passesFilters(fresh)) {
        pending.push({ hash: old.hash, snapshot: fresh, lastSeenAt: now, attempts: old.attempts || 0 });
      }
    } else if ((old.attempts ?? 0) < graceCycles
        && validateSnapshot(old.snapshot)
        && passesFilters(old.snapshot)) {
      pending.push({ ...old, attempts: (old.attempts || 0) + 1 });
    }
  }

  const pendingHashes = new Set(pending.map(item => item.hash));
  for (const hash of orderedHashes) {
    if (seenSet.has(hash) || pendingHashes.has(hash)) continue;
    const deal = dealsByHash.get(hash);
    if (!deal || !passesFilters(deal)) continue;
    pending.push({ hash, snapshot: deal, lastSeenAt: now, attempts: 0 });
    pendingHashes.add(hash);
    if (pending.length >= limit) break;
  }
  return pending;
}

export type DiscountFailurePlan =
  | { action: "requeue"; retry: PendingDiscount }
  | { action: "dead-letter"; attempts: number };

export function planDiscountFailure(item: PendingDiscount, maxAttempts: number): DiscountFailurePlan {
  const verdict = planNotificationFailure(item.attempts, maxAttempts);
  if (verdict.action === "requeue") return { action: "requeue", retry: { ...item, attempts: verdict.attempts } };
  return { action: "dead-letter", attempts: verdict.attempts };
}
