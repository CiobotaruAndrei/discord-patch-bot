const MAX_TRACKED_FORMATS = 64;

const totals = new Map<string, number>();

export function normalizeUninspectableFormat(format: string): string | undefined {
  const trimmed = format.trim().toLowerCase().replace(/[^a-z0-9 -]/g, "");
  if (trimmed.length === 0 || trimmed.length > 32) return undefined;
  return trimmed.replace(/\s+/g, "_");
}

export function recordUninspectableFormat(format: string): void {
  const key = normalizeUninspectableFormat(format);
  if (key === undefined) return;
  if (!totals.has(key) && totals.size >= MAX_TRACKED_FORMATS) return;
  totals.set(key, (totals.get(key) ?? 0) + 1);
}

export function getUninspectableFormatTotals(): Record<string, number> {
  return Object.fromEntries(totals);
}

export function resetUninspectableFormatTotals(): void {
  totals.clear();
}
