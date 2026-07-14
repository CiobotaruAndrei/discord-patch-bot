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
    const fresh = Number.isFinite(fetchedAt) && Date.now() - fetchedAt < options.maxSnapshotAgeMs;
    const items = fresh && Array.isArray(snapshot?.payload)
      ? snapshot.payload.filter(options.validateItem)
      : [];
    if (items.length === 0) throw options.createUnavailableError?.(error) ?? error;
    options.onFallback(error);
    return items;
  }
}
