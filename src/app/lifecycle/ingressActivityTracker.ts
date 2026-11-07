export interface IngressActivityTracker {
  track<T>(label: string, work: Promise<T>): Promise<T>;
  activeCount(): number;
  activeLabels(): string[];
  waitForIdle(timeoutMs: number): Promise<boolean>;
}

export function createIngressActivityTracker(): IngressActivityTracker {
  const active = new Map<number, string>();
  const idleWaiters = new Set<() => void>();
  let nextId = 0;

  function settle(id: number): void {
    active.delete(id);
    if (active.size > 0) return;
    for (const wake of [...idleWaiters]) wake();
  }

  return {
    track<T>(label: string, work: Promise<T>): Promise<T> {
      const id = nextId;
      nextId += 1;
      active.set(id, label);
      return work.finally(() => settle(id));
    },

    activeCount: () => active.size,

    activeLabels: () => [...active.values()],

    waitForIdle(timeoutMs: number): Promise<boolean> {
      if (active.size === 0) return Promise.resolve(true);
      return new Promise<boolean>(resolve => {
        const timer = setTimeout(() => {
          idleWaiters.delete(wake);
          resolve(false);
        }, Math.max(0, timeoutMs));
        if (typeof timer.unref === "function") timer.unref();
        function wake(): void {
          clearTimeout(timer);
          idleWaiters.delete(wake);
          resolve(true);
        }
        idleWaiters.add(wake);
      });
    }
  };
}
