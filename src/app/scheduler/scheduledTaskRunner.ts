export interface ScheduledTaskResult {
  status: "completed" | "failed" | "skipped";
  durationMs: number;
  error?: unknown;
}

export interface ScheduledTaskRunner {
  start(): void;
  stop(): Promise<void>;
  runNow(): Promise<ScheduledTaskResult>;
  isRunning(): boolean;
}

export interface CreateScheduledTaskRunnerDeps {
  intervalMs: number;
  task(signal: AbortSignal): void | Promise<void>;
  onResult?(result: ScheduledTaskResult): void;
  now?: () => number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  shutdownTimeoutMs?: number;
}

export function createScheduledTaskRunner(deps: CreateScheduledTaskRunnerDeps): ScheduledTaskRunner {
  const now = deps.now ?? Date.now;
  const setIntervalFn = deps.setIntervalFn ?? setInterval;
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval;
  let timer: ReturnType<typeof setInterval> | null = null;
  let active: Promise<ScheduledTaskResult> | null = null;
  let abortController: AbortController | null = null;

  async function runNow(): Promise<ScheduledTaskResult> {
    if (active) {
      const result = { status: "skipped", durationMs: 0 } satisfies ScheduledTaskResult;
      deps.onResult?.(result);
      return result;
    }
    const startedAt = now();
    const controller = new AbortController();
    abortController = controller;
    active = (async () => {
      try {
        await deps.task(controller.signal);
        return { status: "completed", durationMs: Math.max(0, now() - startedAt) } satisfies ScheduledTaskResult;
      } catch (error) {
        return { status: "failed", durationMs: Math.max(0, now() - startedAt), error } satisfies ScheduledTaskResult;
      }
    })();
    try {
      const result = await active;
      deps.onResult?.(result);
      return result;
    } finally {
      active = null;
      abortController = null;
    }
  }

  function start(): void {
    if (timer) return;
    timer = setIntervalFn(() => { void runNow(); }, deps.intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  async function stop(): Promise<void> {
    if (timer) clearIntervalFn(timer);
    timer = null;
    abortController?.abort();
    const running = active;
    if (!running) return;
    const shutdownTimeoutMs = deps.shutdownTimeoutMs ?? 5000;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        running.then(() => undefined),
        new Promise<void>(resolve => { timeout = setTimeout(resolve, shutdownTimeoutMs); })
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  return { start, stop, runNow, isRunning: () => active !== null };
}
