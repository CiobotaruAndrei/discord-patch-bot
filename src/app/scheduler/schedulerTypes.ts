export interface CronHealthSnapshot {
  successRatio: number | null;
  windowSize: number;
  healthSkipScheduled: boolean;
  avgDurationMs?: number;
}

export interface CronController {
  scheduleNextCron(): void;
  runCronCycle(): Promise<void>;
  stop(): void | Promise<void>;
  shouldAbortCron(): boolean;
  getHealthSnapshot(): CronHealthSnapshot;
}
