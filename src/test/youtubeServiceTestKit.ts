
import { createYouTubeNotificationService } from "../features/youtube/youtubeNotificationService.js";
export { createYouTubeNotificationService } from "../features/youtube/youtubeNotificationService.js";
export type ServiceDeps = Parameters<typeof createYouTubeNotificationService>[0];
export type YouTubeService = ReturnType<typeof createYouTubeNotificationService>;

export async function manualShow(
  service: YouTubeService,
  client: Parameters<YouTubeService["deliverManualVideos"]>[0],
  guild: Parameters<YouTubeService["prepareManualVideos"]>[0],
  selectedChannelId: string
) {
  const prepared = await service.prepareManualVideos(guild, selectedChannelId);
  return service.deliverManualVideos(client, guild, { items: prepared.deliverable, claimed: prepared.claimed }, true);
}

export const channel = {
  channelId: "UC1234567890123456789012",
  channelName: "Canal Test",
  channelUrl: "https://www.youtube.com/channel/UC1234567890123456789012",
  subscribedAt: new Date()
};

export const video = {
  videoId: "abcdefghijk",
  channelId: channel.channelId,
  channelName: channel.channelName,
  title: "Videoclip nou",
  link: "https://www.youtube.com/watch?v=abcdefghijk",
  publishedAt: "2026-06-24T06:00:00.000Z",
  thumbnail: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg"
};

export function sequentialRunConcurrent<T>(
  items: T[],
  _concurrency: number,
  fn: (item: T) => Promise<unknown>
): Promise<{ processed: number; errors: Array<{ error: unknown }> }> {
  return (async () => {
    const errors: Array<{ error: unknown }> = [];
    let processed = 0;
    for (const item of items) {
      try {
        await fn(item);
        processed++;
      } catch (error) {
        errors.push({ error });
      }
    }
    return { processed, errors };
  })();
}

export function parallelRunConcurrent<T>(
  items: T[],
  _concurrency: number,
  fn: (item: T) => Promise<unknown>
): Promise<{ processed: number; errors: Array<{ error: unknown }> }> {
  return (async () => {
    const errors: Array<{ error: unknown }> = [];
    await Promise.all(items.map(async item => {
      try { await fn(item); }
      catch (error) { errors.push({ error }); }
    }));
    return { processed: items.length - errors.length, errors };
  })();
}
