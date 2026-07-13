import type {
  GuildSettings,
  LoggerFunction,
  YouTubeChannelSubscription,
  YouTubeFilters,
  YouTubeVideo,
  YouTubeVideoMetadata
} from "../../types.js";
import type {
  NotificationDiscordClient,
  ResolveOutboundChannelResult
} from "../notifications/outboundChannel.js";
import type { ReportRollbackFailure } from "../notifications/rollbackReporter.js";
import {
  YOUTUBE_BATCH_DELAY_MS,
  isRecentYouTubeVideo,
  youtubeDestinationIds
} from "./youtubeDeliveryPolicy.js";
import { createYouTubeFeedLoader, type FeedResult } from "./youtubeFeedLoader.js";
import { createYouTubeMetadataResolver, type MetadataResolver } from "./youtubeMetadataResolver.js";
import { createYouTubeFilterEngine } from "./youtubeFilterEngine.js";
import { createYouTubeDeliveryExecutor, type DeliveryResult } from "./youtubeDeliveryExecutor.js";
import { createYouTubeRollbackPolicy } from "./youtubeRollbackPolicy.js";
import { buildYouTubeEmbed, packYouTubeDeliveries, sortedVideos, type PreparedVideo } from "./youtubeDeliveryPlanner.js";

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
  removeRouteForChannelError(guildId: string, channelId: string, message: string): Promise<object>;
  resolveOutboundChannel(args: {
    client: NotificationDiscordClient;
    guild: GuildSettings;
    channelId: string | null | undefined;
    context: string;
    disableFn: (guildId: string, channelId: string, message: string) => Promise<object>;
    bypassOutbox?: boolean;
    manual?: boolean;
  }): Promise<ResolveOutboundChannelResult>;
  sleepIfPositive(ms: number): Promise<void>;
  transientErrorMessage(error: unknown): string;
  GUILD_PROCESS_CONCURRENCY: number;
  FETCH_CONCURRENCY: number;
  youtubeBatchDelayMs?: number;
  now?: () => Date;
  reportRollbackFailure?: ReportRollbackFailure;
}

export type { PreparedVideo } from "./youtubeDeliveryPlanner.js";

export interface ManualVideoBatch {
  items: PreparedVideo[];
  claimed: boolean;
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
    removeRouteForChannelError,
    resolveOutboundChannel,
    sleepIfPositive,
    transientErrorMessage,
    GUILD_PROCESS_CONCURRENCY,
    FETCH_CONCURRENCY
  } = deps;
  const batchDelayMs = deps.youtubeBatchDelayMs ?? YOUTUBE_BATCH_DELAY_MS;
  const now = deps.now || (() => new Date());
  const reportRollbackFailure = deps.reportRollbackFailure;

  const feedLoader = createYouTubeFeedLoader({ runConcurrent, fetchYouTubeFeed, transientErrorMessage, fetchConcurrency: FETCH_CONCURRENCY });
  const metadataResolver = createYouTubeMetadataResolver({ fetchYouTubeVideoMetadata });
  const filterEngine = createYouTubeFilterEngine({ fetchYouTubeVideoMetadata, videoPassesYouTubeFilters });
  const deliveryExecutor = createYouTubeDeliveryExecutor({
    logger, resolveOutboundChannel, disableNotificationsForChannelError, removeRouteForChannelError, sleepIfPositive, batchDelayMs, now
  });
  const rollbackPolicy = createYouTubeRollbackPolicy({ rollbackVideo, logger, reportRollbackFailure });

  const { loadFeeds } = feedLoader;
  const { createMetadataCache } = metadataResolver;
  const { prepareVideo } = filterEngine;
  const { deliverPrepared } = deliveryExecutor;

  async function processGuild(
    client: NotificationDiscordClient,
    guild: GuildSettings,
    feeds: ReadonlyMap<string, FeedResult>,
    shouldAbort: () => boolean,
    resolveMetadata: MetadataResolver = fetchYouTubeVideoMetadata
  ): Promise<void> {
    const guildId = String(guild._id);
    const prepared: PreparedVideo[] = [];
    const claimedPrepared: PreparedVideo[] = [];
    for (const channel of guild.youtubeChannels || []) {
      if (shouldAbort()) {
        await rollbackPolicy.rollbackClaimedItems(guildId, claimedPrepared);
        return;
      }
      const result = feeds.get(channel.channelId);
      if (!result || result.error) {
        await recordChannelError(guildId, channel, result?.error || "Feed YouTube indisponibil.");
        continue;
      }
      const ordered = sortedVideos(result.videos);
      await recordChannelSuccess(guildId, channel, ordered.at(-1)?.videoId || channel.lastVideoId || "");
      const hasDestination = youtubeDestinationIds(guild, channel.channelId).length > 0;
      for (const video of ordered) {
        if (shouldAbort()) {
          await rollbackPolicy.rollbackClaimedItems(guildId, claimedPrepared);
          return;
        }
        const recent = isRecentYouTubeVideo(video, now());
        if (!recent) {
          await claimVideo(guildId, channel.channelId, video.videoId);
          continue;
        }
        if (!guild.youtubeNotificationsEnabled) {
          if (guild.youtubeHasActivated) await claimVideo(guildId, channel.channelId, video.videoId);
          continue;
        }
        if (!hasDestination) continue;
        if (!(await claimVideo(guildId, channel.channelId, video.videoId))) continue;
        try {
          const item = await prepareVideo(guild, channel, video, resolveMetadata);
          if (!item) continue;
          prepared.push(item);
          claimedPrepared.push(item);
        } catch (error) {
          await rollbackPolicy.rollbackClaimedVideo(guildId, channel.channelId, video.videoId);
          await recordChannelError(guildId, channel, transientErrorMessage(error));
        }
      }
    }
    if (!prepared.length) return;
    if (shouldAbort()) {
      await rollbackPolicy.rollbackClaimedItems(guildId, claimedPrepared);
      return;
    }
    const delivery = await deliverPrepared(client, guild, prepared, false, shouldAbort);
    const failed = delivery.states.filter(state => !state.successful).map(state => state.item);
    await rollbackPolicy.rollbackClaimedItems(guildId, failed);
  }

  async function prepareManualVideos(
    guild: GuildSettings,
    selectedChannelId: string,
    force = false
  ): Promise<{ deliverable: PreparedVideo[]; skipped: number; claimed: boolean }> {
    const selectedChannels = (guild.youtubeChannels || []).filter(channel =>
      selectedChannelId === "toate" || channel.channelId === selectedChannelId
    );
    const resolveMetadata = createMetadataCache();
    const feedByChannel = new Map<string, YouTubeVideo[]>();
    await runConcurrent(selectedChannels, Math.max(1, FETCH_CONCURRENCY), async channel => {
      try {
        const videos = sortedVideos(await fetchYouTubeFeed(channel));
        await recordChannelSuccess(String(guild._id), channel, videos.at(-1)?.videoId || channel.lastVideoId || "");
        feedByChannel.set(channel.channelId, videos);
      } catch (error) {
        await recordChannelError(String(guild._id), channel, transientErrorMessage(error));
      }
    });
    const deliverable: PreparedVideo[] = [];
    let skipped = 0;
    for (const channel of selectedChannels) {
      const videos = feedByChannel.get(channel.channelId);
      if (!videos) continue;
      const hasDestination = youtubeDestinationIds(guild, channel.channelId).length > 0;
      for (const video of videos) {
        if (!isRecentYouTubeVideo(video, now())) continue;
        if (!hasDestination) {
          skipped++;
          continue;
        }
        let item: PreparedVideo | null;
        try {
          item = await prepareVideo(guild, channel, video, resolveMetadata);
        } catch (error) {
          await recordChannelError(String(guild._id), channel, transientErrorMessage(error));
          continue;
        }
        if (!item) continue;
        if (!force && !(await claimVideo(String(guild._id), channel.channelId, video.videoId))) continue;
        deliverable.push(item);
      }
    }
    return { deliverable, skipped, claimed: !force };
  }

  async function deliverManualVideos(
    client: NotificationDiscordClient,
    guild: GuildSettings,
    batch: ManualVideoBatch,
    bypassOutbox = true
  ): Promise<DeliveryResult> {
    const delivery = await deliverPrepared(client, guild, batch.items, bypassOutbox, () => false, !bypassOutbox, true);
    if (batch.claimed) {
      const guildId = String(guild._id);
      for (const state of delivery.states) {
        if (!state.successful) {
          await rollbackPolicy.rollbackClaimedVideo(guildId, state.item.channel.channelId, state.item.video.videoId);
        }
      }
    }
    return delivery.result;
  }

  async function checkForYouTube(
    client: NotificationDiscordClient,
    shouldAbort: (() => boolean) | null = null
  ): Promise<void> {
    const abort = shouldAbort || (() => false);
    const guilds = await GuildModel.find({ "youtubeChannels.0": { $exists: true } }).lean();
    if (!guilds.length || abort()) return;
    const feeds = await loadFeeds(guilds);
    const resolveMetadata = createMetadataCache();
    const result = await runConcurrent(
      guilds,
      Math.max(1, GUILD_PROCESS_CONCURRENCY),
      guild => processGuild(client, guild, feeds, abort, resolveMetadata)
    );
    if (result.errors.length === guilds.length && guilds.length > 0) {
      throw new Error(
        `Verificarea YouTube a esuat pentru toate cele ${guilds.length} servere: ${transientErrorMessage(result.errors[0]?.error)}`
      );
    }
  }

  return { checkForYouTube, processGuild, loadFeeds, prepareManualVideos, deliverManualVideos };
}

export { buildYouTubeEmbed, packYouTubeDeliveries, sortedVideos };
