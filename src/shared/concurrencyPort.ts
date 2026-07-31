"use strict";

export interface ConcurrentRunResult<T> {
  processed: number;
  errors: Array<{
    index: number;
    item: T;
    error: unknown;
  }>;
}

export interface ConcurrentRunOptions<T> {
  shouldAbort?: (() => boolean) | null;
  errorLogger?: ((item: T, err: unknown) => void) | null;
}

export type RunConcurrent = <T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => unknown,
  options?: ConcurrentRunOptions<T>
) => Promise<ConcurrentRunResult<T>>;
