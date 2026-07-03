export interface CronHealthSnapshot {
  successRatio: number | null;
  windowSize: number;
  healthSkipScheduled: boolean;
  avgDurationMs?: number;
}

export interface CronController {
  scheduleNextCron(): void;
  runCronCycle(): Promise<void>;
  stop(): void;
  shouldAbortCron(): boolean;
  getHealthSnapshot(): CronHealthSnapshot;
}
