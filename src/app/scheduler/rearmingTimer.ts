type TimerHandle = ReturnType<typeof setTimeout>;

interface RearmingTimerDeps {
  isShuttingDown: () => boolean;
  delayMs: () => number;
  onTick: () => void;
}

interface RearmingTimer {
  schedule(): void;
  stop(): void;
  isActive(): boolean;
}

function createRearmingTimer({ isShuttingDown, delayMs, onTick }: RearmingTimerDeps): RearmingTimer {
  let timerId: TimerHandle | null = null;

  function schedule(): void {
    if (isShuttingDown()) return;
    if (timerId) clearTimeout(timerId);
    timerId = setTimeout(onTick, delayMs());
    if (typeof timerId.unref === "function") timerId.unref();
  }

  function stop(): void {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  function isActive(): boolean {
    return timerId !== null;
  }

  return { schedule, stop, isActive };
}

export { createRearmingTimer };
export type { RearmingTimer, RearmingTimerDeps };
