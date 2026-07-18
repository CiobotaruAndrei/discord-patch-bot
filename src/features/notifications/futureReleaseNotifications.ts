"use strict";

export const FUTURE_RELEASE_THRESHOLD_DAYS = [30, 7, 1] as const;
export type FutureReleaseThresholdDay = (typeof FUTURE_RELEASE_THRESHOLD_DAYS)[number];

const DAY_MS = 86_400_000;

export interface FutureReleaseObservation {
  gameName: string;
  releaseDate?: string | null;
  preorderPrice?: string | null;
}

export interface FutureReleaseGameState {
  baselineDone: boolean;
  notifiedThresholdDays: FutureReleaseThresholdDay[];
  preorderSeen: boolean;
  observedPreorderPrice: string | null;
}

export type FutureReleaseNotification =
  | { kind: "threshold"; gameName: string; days: FutureReleaseThresholdDay; releaseDate: string }
  | { kind: "preorder-available"; gameName: string; price: string }
  | { kind: "price-changed"; gameName: string; from: string; to: string }
  | { kind: "preorder-removed"; gameName: string };

export function initialFutureReleaseState(): FutureReleaseGameState {
  return { baselineDone: false, notifiedThresholdDays: [], preorderSeen: false, observedPreorderPrice: null };
}

export function parseReleaseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  if (/^\d{4}$/.test(value.trim())) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function daysUntil(releaseTs: number, now: number): number {
  return (releaseTs - now) / DAY_MS;
}

function crossedThresholds(releaseTs: number | null, now: number): FutureReleaseThresholdDay[] {
  if (releaseTs === null) return [];
  const remaining = daysUntil(releaseTs, now);
  if (remaining < 0) return [];
  return FUTURE_RELEASE_THRESHOLD_DAYS.filter(threshold => remaining <= threshold);
}

function normalizePrice(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function computeFutureReleaseUpdate(
  observation: FutureReleaseObservation,
  state: FutureReleaseGameState,
  now: number
): { notifications: FutureReleaseNotification[]; nextState: FutureReleaseGameState } {
  const releaseTs = parseReleaseTimestamp(observation.releaseDate);
  const currentPreorder = normalizePrice(observation.preorderPrice);

  if (!state.baselineDone) {
    return {
      notifications: [],
      nextState: {
        baselineDone: true,
        notifiedThresholdDays: crossedThresholds(releaseTs, now),
        preorderSeen: currentPreorder !== null,
        observedPreorderPrice: currentPreorder
      }
    };
  }

  const notifications: FutureReleaseNotification[] = [];
  const notified = new Set<FutureReleaseThresholdDay>(state.notifiedThresholdDays);

  if (releaseTs !== null && observation.releaseDate) {
    const pending = crossedThresholds(releaseTs, now).filter(threshold => !notified.has(threshold));
    if (pending.length > 0) {
      const nearest = Math.min(...pending) as FutureReleaseThresholdDay;
      for (const threshold of pending) notified.add(threshold);
      notifications.push({ kind: "threshold", gameName: observation.gameName, days: nearest, releaseDate: observation.releaseDate });
    }
  }

  let preorderSeen = state.preorderSeen;
  let observedPreorderPrice = state.observedPreorderPrice;

  if (!state.preorderSeen && currentPreorder !== null) {
    preorderSeen = true;
    observedPreorderPrice = currentPreorder;
    notifications.push({ kind: "preorder-available", gameName: observation.gameName, price: currentPreorder });
  } else if (state.preorderSeen && currentPreorder === null) {
    preorderSeen = false;
    observedPreorderPrice = null;
    notifications.push({ kind: "preorder-removed", gameName: observation.gameName });
  } else if (state.preorderSeen && currentPreorder !== null && state.observedPreorderPrice !== null && currentPreorder !== state.observedPreorderPrice) {
    notifications.push({ kind: "price-changed", gameName: observation.gameName, from: state.observedPreorderPrice, to: currentPreorder });
    observedPreorderPrice = currentPreorder;
  }

  return {
    notifications,
    nextState: {
      baselineDone: true,
      notifiedThresholdDays: [...notified].sort((a, b) => b - a),
      preorderSeen,
      observedPreorderPrice
    }
  };
}

export default { computeFutureReleaseUpdate, initialFutureReleaseState, parseReleaseTimestamp, FUTURE_RELEASE_THRESHOLD_DAYS };
