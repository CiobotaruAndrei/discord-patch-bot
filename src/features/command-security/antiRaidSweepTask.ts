"use strict";

export const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

export interface SweepTaskDeps {
  sweep: () => Promise<string[]>;
  intervalMs?: number;
  logger?: (level: string, scope: string, message: string, detail?: Record<string, unknown>) => void;
  setTimer?: (handler: () => void, ms: number) => { unref?: () => void };
  clearTimer?: (handle: unknown) => void;
}

export function createAntiRaidSweepTask(deps: SweepTaskDeps) {
  const intervalMs = deps.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const setTimer = deps.setTimer ?? ((handler, ms) => setInterval(handler, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearInterval(handle as NodeJS.Timeout));
  let handle: { unref?: () => void } | null = null;
  let running = false;

  async function runOnce(): Promise<string[]> {
    if (running) return [];
    running = true;
    try {
      return await deps.sweep();
    } catch (error: unknown) {
      deps.logger?.("ERROR", "ANTI_RAID", "Ciclul periodic anti-raid a esuat", {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    } finally {
      running = false;
    }
  }

  function start(): void {
    if (handle) return;
    handle = setTimer(() => { void runOnce(); }, intervalMs);
    handle.unref?.();
  }

  function stop(): void {
    if (!handle) return;
    clearTimer(handle);
    handle = null;
  }

  return { start, stop, runOnce, isRunning: () => handle !== null };
}

export type AntiRaidSweepTask = ReturnType<typeof createAntiRaidSweepTask>;
