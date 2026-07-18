import type { PlayerCountHistoryPoint } from "./playerCountSnapshotService.js";

export type PlayerCountDirection = "rising" | "falling" | "stable";

export interface PlayerCountStats {
  minimum: number;
  maximum: number;
  average: number;
  latest: number;
  peakAt: Date;
  direction: PlayerCountDirection | null;
}

export interface PlayerCountWindow {
  from: Date;
  to: Date;
}

function average(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function nearestPoint(points: readonly PlayerCountHistoryPoint[], target: number, maxDistance: number): PlayerCountHistoryPoint | null {
  let selected: PlayerCountHistoryPoint | null = null;
  let selectedDistance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const distance = Math.abs(point.fetchedAt.getTime() - target);
    if (distance <= maxDistance && distance < selectedDistance) {
      selected = point;
      selectedDistance = distance;
    }
  }
  return selected;
}

function timeDirection(points: readonly PlayerCountHistoryPoint[], window: PlayerCountWindow): PlayerCountDirection | null {
  const from = window.from.getTime();
  const to = window.to.getTime();
  const duration = to - from;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const early = nearestPoint(points, from + duration * 0.25, duration * 0.25);
  const late = nearestPoint(points, from + duration * 0.75, duration * 0.25);
  if (!early || !late || early === late || early.fetchedAt.getTime() >= late.fetchedAt.getTime()) return null;
  const delta = late.playerCount - early.playerCount;
  const threshold = Math.max(1, Math.abs(early.playerCount) * 0.02);
  return delta > threshold ? "rising" : delta < -threshold ? "falling" : "stable";
}

export function calculatePlayerCountStats(
  source: readonly PlayerCountHistoryPoint[],
  requestedWindow?: PlayerCountWindow
): PlayerCountStats | null {
  const valid = source
    .filter(point => Number.isFinite(point.playerCount) && Number.isFinite(point.fetchedAt.getTime()))
    .sort((left, right) => left.fetchedAt.getTime() - right.fetchedAt.getTime());
  if (valid.length < 2) return null;
  const window = requestedWindow ?? { from: valid[0].fetchedAt, to: valid.at(-1)?.fetchedAt ?? valid[0].fetchedAt };
  const from = window.from.getTime();
  const to = window.to.getTime();
  const points = valid.filter(point => {
    const timestamp = point.fetchedAt.getTime();
    return timestamp >= from && timestamp <= to;
  });
  if (points.length < 2) return null;
  const counts = points.map(point => point.playerCount);
  const maximum = Math.max(...counts);
  const peakPoint = points.find(point => point.playerCount === maximum) ?? points[0];
  return {
    minimum: Math.min(...counts),
    maximum,
    average: Math.round(average(counts)),
    latest: counts.at(-1) ?? 0,
    peakAt: new Date(peakPoint.fetchedAt),
    direction: timeDirection(points, window)
  };
}

export function playerCountDirectionLabel(direction: PlayerCountDirection | null): string {
  if (direction === "rising") return "in crestere";
  if (direction === "falling") return "in scadere";
  if (direction === "stable") return "stabil";
  return "indisponibila";
}
