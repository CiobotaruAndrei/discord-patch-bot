import type { GameConfig } from "../../config/configTypes.js";
import type { NotificationDiscordClient } from "../../features/notifications/outboundChannel.js";

type ShouldAbort = () => boolean;

export interface CronCommandsForJobs {
  checkForUpdates(client: unknown, games: GameConfig[], shouldAbort: ShouldAbort): Promise<void>;
  checkForDiscounts(client: unknown, shouldAbort: ShouldAbort): Promise<void>;
  checkForDlcs?(client: unknown, games: GameConfig[], shouldAbort: ShouldAbort): Promise<void>;
  checkForYouTube(client: unknown, shouldAbort: ShouldAbort): Promise<void>;
  refreshPlayerCountSnapshots?(games: GameConfig[], shouldAbort: ShouldAbort, client?: NotificationDiscordClient): Promise<unknown>;
}

interface CronNotificationClient {
  user?: { id?: string } | null;
  channels?: NotificationDiscordClient["channels"];
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
  client: CronNotificationClient,
  games: GameConfig[],
  shedDiscounts: boolean,
  shouldAbort: ShouldAbort
): CronJob[] {
  return [
    { label: "checkForUpdates", run: commands.checkForUpdates(client, games, shouldAbort) },
    ...(shedDiscounts ? [] : [{ label: "checkForDiscounts", run: commands.checkForDiscounts(client, shouldAbort) }]),
    ...(typeof commands.checkForDlcs === "function"
      ? [{ label: "checkForDlcs", run: commands.checkForDlcs(client, games, shouldAbort) }]
      : []),
    { label: "checkForYouTube", run: commands.checkForYouTube(client, shouldAbort) },
    ...(typeof commands.refreshPlayerCountSnapshots === "function"
      ? [{ label: "refreshPlayerCountSnapshots", run: commands.refreshPlayerCountSnapshots(games, shouldAbort, client.channels ? { user: client.user, channels: client.channels } : undefined) }]
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
