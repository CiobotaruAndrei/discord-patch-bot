export interface NotificationFeedSnapshot {
  payload: unknown;
  fetchedAt: Date;
}

interface NotificationFeedLoaderOptions<T> {
  snapshotId: string;
  fetchFresh: () => Promise<T[]>;
  validateItem: (item: unknown) => item is T;
  persistFresh?: (items: T[]) => Promise<void>;
  loadSnapshot?: (id: string) => Promise<NotificationFeedSnapshot | null>;
  maxSnapshotAgeMs: number;
  onFallback: (error: unknown) => void;
  createUnavailableError?: (error: unknown) => Error;
  invalidSnapshotItemPolicy?: "reject-snapshot" | "drop-invalid";
  now?: () => number;
}

export async function loadNotificationFeed<T>(options: NotificationFeedLoaderOptions<T>): Promise<T[]> {
  try {
    const items = await options.fetchFresh();
    if (options.persistFresh) await options.persistFresh(items);
    return items;
  } catch (error: unknown) {
    const snapshot = options.loadSnapshot
      ? await options.loadSnapshot(options.snapshotId).catch(() => null)
      : null;
    const fetchedAt = snapshot?.fetchedAt instanceof Date ? snapshot.fetchedAt.getTime() : Number.NaN;
    const ageMs = (options.now ?? Date.now)() - fetchedAt;
    const fresh = Number.isFinite(fetchedAt) && ageMs >= 0 && ageMs < options.maxSnapshotAgeMs;
    if (!fresh || !Array.isArray(snapshot?.payload)) throw options.createUnavailableError?.(error) ?? error;
    const invalidSnapshotItemPolicy = options.invalidSnapshotItemPolicy ?? "reject-snapshot";
    const isValidSnapshotItem = (item: unknown): item is T => {
      try {
        return options.validateItem(item);
      } catch {
        return false;
      }
    };
    const invalidItems = snapshot.payload.filter(item => !isValidSnapshotItem(item));
    if (invalidSnapshotItemPolicy === "reject-snapshot" && invalidItems.length > 0) {
      throw options.createUnavailableError?.(error) ?? error;
    }
    const items = snapshot.payload.filter(isValidSnapshotItem);
    if (snapshot.payload.length > 0 && items.length === 0) {
      throw options.createUnavailableError?.(error) ?? error;
    }
    options.onFallback(error);
    return items;
  }
}
