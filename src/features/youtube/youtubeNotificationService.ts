import type {
  GuildSettings,
  LoggerFunction,
  YouTubeChannelSubscription,
  YouTubeFilters,
  YouTubeVideo,
  YouTubeVideoMetadata
} from "../../types";
import type {
  NotificationDiscordClient,
  ResolveOutboundChannelResult
} from "../notifications/outboundChannel";
import { embedCharCost, packEmbedsByBudget } from "../../shared/discordEmbedChunks";

interface GuildFindResult {
  lean(): Promise<GuildSettings[]>;
}

interface GuildModelLike {
  find(filter: object): GuildFindResult;
}

interface YouTubeNotificationServiceDeps {
  GuildModel: GuildModelLike;
  logger: LoggerFunction;
  runConcurrent<T>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<unknown>
  ): Promise<{ processed: number; errors: Array<{ error: unknown }> }>;
  fetchYouTubeFeed(channel: { channelId: string; channelName: string }): Promise<YouTubeVideo[]>;
  fetchYouTubeVideoMetadata(video: YouTubeVideo): Promise<YouTubeVideoMetadata>;
  videoPassesYouTubeFilters(metadata: YouTubeVideoMetadata, filters?: YouTubeFilters | null): boolean;
  claimVideo(guildId: string, channelId: string, videoId: string): Promise<boolean>;
  rollbackVideo(guildId: string, channelId: string, videoId: string): Promise<void>;
  recordChannelSuccess(guildId: string, channel: YouTubeChannelSubscription, newestVideoId: string): Promise<void>;
  recordChannelError(guildId: string, channel: YouTubeChannelSubscription, message: string): Promise<void>;
  disableNotificationsForChannelError(guildId: string, channelId: string, message: string): Promise<object>;
  resolveOutboundChannel(args: {
    client: NotificationDiscordClient;
    guild: GuildSettings;
    channelId: string | null | undefined;
    context: string;
    disableFn: (guildId: string, channelId: string, message: string) => Promise<object>;
  }): Promise<ResolveOutboundChannelResult>;
  sleepIfPositive(ms: number): Promise<void>;
  transientErrorMessage(error: unknown): string;
  DISCORD_SEND_DELAY_MS: number;
  GUILD_PROCESS_CONCURRENCY: number;
  FETCH_CONCURRENCY: number;
}

interface FeedResult {
  videos: YouTubeVideo[];
  error: string;
}

interface ClaimedVideo {
  channel: YouTubeChannelSubscription;
  video: YouTubeVideo;
  metadata: YouTubeVideoMetadata;
}

function buildYouTubeEmbed(item: ClaimedVideo): object {
  const duration = item.metadata.durationSeconds === null
    ? "necunoscuta"
    : `${Math.floor(item.metadata.durationSeconds / 60)}m ${item.metadata.durationSeconds % 60}s`;
  return {
    title: item.video.title,
    url: item.video.link,
    description: `Videoclip nou de la **${item.channel.channelName}**`,
    color: 0xff0000,
    thumbnail: { url: item.video.thumbnail },
    fields: [
      { name: "Durata", value: duration, inline: true },
      { name: "Canal", value: `[${item.channel.channelName}](${item.channel.channelUrl})`, inline: true }
    ],
    timestamp: item.video.publishedAt || new Date().toISOString()
  };
}

function sortedVideos(videos: YouTubeVideo[]): YouTubeVideo[] {
  return videos.slice().sort((left, right) => {
    const leftTime = Date.parse(left.publishedAt) || 0;
    const rightTime = Date.parse(right.publishedAt) || 0;
    return leftTime - rightTime;
  });
}

export function createYouTubeNotificationService(deps: YouTubeNotificationServiceDeps) {
  const {
    GuildModel,
    logger,
    runConcurrent,
    fetchYouTubeFeed,
    fetchYouTubeVideoMetadata,
    videoPassesYouTubeFilters,
    claimVideo,
    rollbackVideo,
    recordChannelSuccess,
    recordChannelError,
    disableNotificationsForChannelError,
    resolveOutboundChannel,
    sleepIfPositive,
    transientErrorMessage,
    DISCORD_SEND_DELAY_MS,
    GUILD_PROCESS_CONCURRENCY,
    FETCH_CONCURRENCY
  } = deps;

  async function loadFeeds(guilds: GuildSettings[]): Promise<Map<string, FeedResult>> {
    const unique = new Map<string, { channelId: string; channelName: string }>();
    for (const guild of guilds) {
      for (const channel of guild.youtubeChannels || []) {
        if (!unique.has(channel.channelId)) {
          unique.set(channel.channelId, {
            channelId: channel.channelId,
            channelName: channel.channelName
          });
        }
      }
    }
    const results = new Map<string, FeedResult>();
    await runConcurrent(
      Array.from(unique.values()),
      Math.max(1, FETCH_CONCURRENCY),
      async channel => {
        try {
          const videos = await fetchYouTubeFeed(channel);
          results.set(channel.channelId, { videos, error: "" });
        } catch (error) {
          results.set(channel.channelId, {
            videos: [],
            error: transientErrorMessage(error)
          });
        }
      }
    );
    return results;
  }

  async function processGuild(
    client: NotificationDiscordClient,
    guild: GuildSettings,
    feeds: ReadonlyMap<string, FeedResult>,
    shouldAbort: () => boolean
  ): Promise<void> {
    const guildId = String(guild._id);
    const claimed: ClaimedVideo[] = [];
    const rollbackClaimed = async (items: ClaimedVideo[]): Promise<void> => {
      for (const item of items) {
        await rollbackVideo(guildId, item.channel.channelId, item.video.videoId).catch(() => undefined);
      }
    };
    for (const channel of guild.youtubeChannels || []) {
      if (shouldAbort()) {
        await rollbackClaimed(claimed);
        return;
      }
      const result = feeds.get(channel.channelId);
      if (!result || result.error) {
        await recordChannelError(guildId, channel, result?.error || "Feed YouTube indisponibil.");
        continue;
      }
      const ordered = sortedVideos(result.videos);
      await recordChannelSuccess(guildId, channel, ordered.at(-1)?.videoId || channel.lastVideoId || "");
      for (const video of ordered) {
        if (shouldAbort()) {
          await rollbackClaimed(claimed);
          return;
        }
        if (!(await claimVideo(guildId, channel.channelId, video.videoId))) continue;
        if (!guild.youtubeNotificationsEnabled || !guild.youtubeNotificationChannelId) continue;
        try {
          const metadata = await fetchYouTubeVideoMetadata(video);
          if (shouldAbort()) {
            await rollbackVideo(guildId, channel.channelId, video.videoId).catch(() => undefined);
            await rollbackClaimed(claimed);
            return;
          }
          if (!videoPassesYouTubeFilters(metadata, guild.youtubeFilters)) continue;
          claimed.push({ channel, video, metadata });
        } catch (error) {
          await rollbackVideo(guildId, channel.channelId, video.videoId).catch(() => undefined);
          await recordChannelError(guildId, channel, transientErrorMessage(error));
        }
      }
    }
    if (!claimed.length) return;
    if (shouldAbort()) {
      await rollbackClaimed(claimed);
      return;
    }
    const resolved = await resolveOutboundChannel({
      client,
      guild,
      channelId: guild.youtubeNotificationChannelId,
      context: "CRON_YOUTUBE",
      disableFn: disableNotificationsForChannelError
    });
    if (resolved.abort) {
      await rollbackClaimed(claimed);
      return;
    }
    const chunks = packEmbedsByBudget(
      claimed,
      item => embedCharCost(buildYouTubeEmbed(item)),
      { maxCount: 10 }
    );
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      try {
        await resolved.channel.send(
          { embeds: chunk.map(buildYouTubeEmbed) },
          {
            historyEntries: chunk.map(item => ({
              kind: "youtube" as const,
              gameKey: `youtube:${item.channel.channelId}`,
              title: item.video.title,
              link: item.video.link,
              itemId: item.video.videoId
            }))
          }
        );
        await sleepIfPositive(DISCORD_SEND_DELAY_MS);
      } catch (error) {
        const pending = chunks.slice(index).flat();
        await rollbackClaimed(pending);
        logger("WARN", "YOUTUBE", `Livrarea YouTube a esuat pentru guild ${guildId}`, error);
        return;
      }
    }
  }

  async function checkForYouTube(
    client: NotificationDiscordClient,
    shouldAbort: (() => boolean) | null = null
  ): Promise<void> {
    const abort = shouldAbort || (() => false);
    const guilds = await GuildModel.find({ "youtubeChannels.0": { $exists: true } }).lean();
    if (!guilds.length || abort()) return;
    const feeds = await loadFeeds(guilds);
    const result = await runConcurrent(
      guilds,
      Math.max(1, GUILD_PROCESS_CONCURRENCY),
      guild => processGuild(client, guild, feeds, abort)
    );
    if (result.errors.length === guilds.length && guilds.length > 0) {
      throw new Error(
        `Verificarea YouTube a esuat pentru toate cele ${guilds.length} servere: ${transientErrorMessage(result.errors[0]?.error)}`
      );
    }
  }

  return { checkForYouTube, processGuild, loadFeeds };
}

export { buildYouTubeEmbed, sortedVideos };
