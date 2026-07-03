import type { GameConfig } from "../../types";

type ShouldAbort = () => boolean;

export interface CronCommandsForJobs {
  checkForUpdates(client: unknown, games: GameConfig[], shouldAbort: ShouldAbort): Promise<void>;
  checkForDiscounts(client: unknown, shouldAbort: ShouldAbort): Promise<void>;
  checkForYouTube(client: unknown, shouldAbort: ShouldAbort): Promise<void>;
  refreshPlayerCountSnapshots?(games: GameConfig[], shouldAbort: ShouldAbort): Promise<unknown>;
}

export interface CronJob {
  label: string;
  run: Promise<unknown>;
}

export interface CronJobFailure {
  label: string;
  reason: unknown;
}

export function buildCronCycleJobs(
  commands: CronCommandsForJobs,
  client: unknown,
  games: GameConfig[],
  shedDiscounts: boolean,
  shouldAbort: ShouldAbort
): CronJob[] {
  return [
    { label: "checkForUpdates", run: commands.checkForUpdates(client, games, shouldAbort) },
    ...(shedDiscounts ? [] : [{ label: "checkForDiscounts", run: commands.checkForDiscounts(client, shouldAbort) }]),
    { label: "checkForYouTube", run: commands.checkForYouTube(client, shouldAbort) },
    ...(typeof commands.refreshPlayerCountSnapshots === "function"
      ? [{ label: "refreshPlayerCountSnapshots", run: commands.refreshPlayerCountSnapshots(games, shouldAbort) }]
      : [])
  ];
}

export async function runCronJobs(jobs: CronJob[]): Promise<CronJobFailure[]> {
  const settled = await Promise.allSettled(jobs.map(job => job.run));
  const failures: CronJobFailure[] = [];
  settled.forEach((result, index) => {
    if (result.status === "rejected") failures.push({ label: jobs[index].label, reason: result.reason });
  });
  return failures;
}
