"use strict";

export interface InflightTracker {
  withInflightTimeout<T>(promise: Promise<T>, label: string): Promise<T>;
  trackInflight<T>(map: Map<string, Promise<T>>, key: string, promise: Promise<T>): void;
}

export function createInflightTracker(timeoutMs: number): InflightTracker {
  function withInflightTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Inflight timeout (${label})`)),
        timeoutMs
      );
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  }

  function trackInflight<T>(map: Map<string, Promise<T>>, key: string, promise: Promise<T>): void {
    map.set(key, promise);
    const cleanup = () => {
      if (map.get(key) === promise) map.delete(key);
    };
    promise.then(cleanup, cleanup);
  }

  return { withInflightTimeout, trackInflight };
}
