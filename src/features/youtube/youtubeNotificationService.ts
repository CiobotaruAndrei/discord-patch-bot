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
import { embedCharCost } from "../../shared/discordEmbedChunks";
import {
  YOUTUBE_BATCH_DELAY_MS,
  YOUTUBE_BATCH_SIZE,
  isRecentYouTubeVideo,
  renderYouTubeMessageTemplate,
  videoPassesYouTubeTitleFilter,
  youtubeDestinationIds
} from "./youtubeDeliveryPolicy";

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
  }): Promise<ResolveOutboundChannelResult>;
  sleepIfPositive(ms: number): Promise<void>;
  transientErrorMessage(error: unknown): string;
  GUILD_PROCESS_CONCURRENCY: number;
  FETCH_CONCURRENCY: number;
  youtubeBatchDelayMs?: number;
  now?: () => Date;
}

interface FeedResult {
  videos: YouTubeVideo[];
  error: string;
}

export interface PreparedVideo {
  channel: YouTubeChannelSubscription;
  video: YouTubeVideo;
  metadata: YouTubeVideoMetadata;
}

export interface ManualVideoBatch {
  items: PreparedVideo[];
  claimed: boolean;
}

interface DeliveryState {
  item: PreparedVideo;
  successful: boolean;
  pendingDestinations: number;
}

interface DeliveryResult {
  videos: number;
  batches: number;
  destinations: number;
}

function buildYouTubeEmbed(item: PreparedVideo): object {
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

function packYouTubeDeliveries(items: PreparedVideo[], template: string | null | undefined): PreparedVideo[][] {
  const batches: PreparedVideo[][] = [];
  let current: PreparedVideo[] = [];
  let currentEmbedChars = 0;
  let currentContentChars = 0;
  for (const item of items) {
    const embedChars = embedCharCost(buildYouTubeEmbed(item));
    const contentChars = renderYouTubeMessageTemplate(template, item.channel, item.video).length + (current.length ? 2 : 0);
    if (
      current.length > 0
      && (
        current.length >= YOUTUBE_BATCH_SIZE
        || currentEmbedChars + embedChars > 5800
        || currentContentChars + contentChars > 1900
      )
    ) {
      batches.push(current);
      current = [];
      currentEmbedChars = 0;
      currentContentChars = 0;
    }
    current.push(item);
    currentEmbedChars += embedChars;
    currentContentChars += renderYouTubeMessageTemplate(template, item.channel, item.video).length + (current.length > 1 ? 2 : 0);
  }
  if (current.length) batches.push(current);
  return batches;
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

  function createMetadataCache(): (video: YouTubeVideo) => Promise<YouTubeVideoMetadata> {
    const cache = new Map<string, Promise<YouTubeVideoMetadata>>();
    return (video: YouTubeVideo) => {
      const cached = cache.get(video.videoId);
      if (cached) return cached;
      const pending = fetchYouTubeVideoMetadata(video);
      cache.set(video.videoId, pending);
      return pending;
    };
  }

  async function prepareVideo(
    guild: GuildSettings,
    channel: YouTubeChannelSubscription,
    video: YouTubeVideo,
    resolveMetadata: (video: YouTubeVideo) => Promise<YouTubeVideoMetadata> = fetchYouTubeVideoMetadata
  ): Promise<PreparedVideo | null> {
    const metadata = await resolveMetadata(video);
    if (!videoPassesYouTubeFilters(metadata, guild.youtubeFilters)) return null;
    if (!videoPassesYouTubeTitleFilter(video, guild.youtubeTitleIncludeWords)) return null;
    return { channel, video, metadata };
  }

  async function deliverPrepared(
    client: NotificationDiscordClient,
    guild: GuildSettings,
    items: PreparedVideo[],
    bypassOutbox: boolean,
    shouldAbort: () => boolean,
    enqueueStaggered = false
  ): Promise<{ result: DeliveryResult; states: DeliveryState[] }> {
    const states: DeliveryState[] = items.map(item => ({ item, successful: false, pendingDestinations: 0 }));
    const stateByItem = new Map(items.map((item, index) => [item, states[index]]));
    const groups = new Map<string, PreparedVideo[]>();
    for (const item of items) {
      const destinationIds = youtubeDestinationIds(guild, item.channel.channelId);
      const state = stateByItem.get(item);
      if (state) state.pendingDestinations = destinationIds.length;
      for (const destinationId of destinationIds) {
        const destinationItems = groups.get(destinationId) || [];
        destinationItems.push(item);
        groups.set(destinationId, destinationItems);
      }
    }
    let batches = 0;
    let destinations = 0;
    for (const [destinationId, destinationItems] of groups) {
      if (shouldAbort()) break;
      const isMainDestination = destinationId === guild.youtubeNotificationChannelId;
      const resolved = await resolveOutboundChannel({
        client,
        guild,
        channelId: destinationId,
        context: "CRON_YOUTUBE",
        disableFn: isMainDestination
          ? disableNotificationsForChannelError
          : removeRouteForChannelError,
        bypassOutbox
      });
      if (resolved.abort) continue;
      destinations++;
      const chunks = packYouTubeDeliveries(destinationItems, guild.youtubeMessageTemplate);
      for (let index = 0; index < chunks.length; index++) {
        if (shouldAbort()) break;
        const chunk = chunks[index];
        try {
          await resolved.channel.send(
            {
              content: chunk
                .map(item => renderYouTubeMessageTemplate(guild.youtubeMessageTemplate, item.channel, item.video))
                .join("\n\n"),
              embeds: chunk.map(buildYouTubeEmbed),
              allowedMentions: { parse: [] }
            },
            {
              historyEntries: chunk.map(item => ({
                kind: "youtube" as const,
                gameKey: `youtube:${item.channel.channelId}`,
                title: item.video.title,
                link: item.video.link,
                itemId: item.video.videoId
              })),
              availableAt: enqueueStaggered ? new Date(now().getTime() + index * batchDelayMs) : undefined
            }
          );
          batches++;
          for (const item of chunk) {
            const state = stateByItem.get(item);
            if (state) state.pendingDestinations = Math.max(0, state.pendingDestinations - 1);
          }
          if (!enqueueStaggered && index < chunks.length - 1) await sleepIfPositive(batchDelayMs);
        } catch (error) {
          logger("WARN", "YOUTUBE", `Livrarea YouTube a esuat pentru guild ${guild._id} si canalul ${destinationId}`, error);
          break;
        }
      }
    }
    for (const state of states) state.successful = state.pendingDestinations === 0;
    return {
      result: {
        videos: states.filter(state => state.successful).length,
        batches,
        destinations
      },
      states
    };
  }

  async function processGuild(
    client: NotificationDiscordClient,
    guild: GuildSettings,
    feeds: ReadonlyMap<string, FeedResult>,
    shouldAbort: () => boolean,
    resolveMetadata: (video: YouTubeVideo) => Promise<YouTubeVideoMetadata> = fetchYouTubeVideoMetadata
  ): Promise<void> {
    const guildId = String(guild._id);
    const prepared: PreparedVideo[] = [];
    const claimedPrepared: PreparedVideo[] = [];
    const rollbackPrepared = async (items: PreparedVideo[]): Promise<void> => {
      for (const item of items) {
        await rollbackVideo(guildId, item.channel.channelId, item.video.videoId).catch(() => undefined);
      }
    };
    for (const channel of guild.youtubeChannels || []) {
      if (shouldAbort()) {
        await rollbackPrepared(claimedPrepared);
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
          await rollbackPrepared(claimedPrepared);
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
        if (!(await claimVideo(guildId, channel.channelId, video.videoId))) continue;
        try {
          const item = await prepareVideo(guild, channel, video, resolveMetadata);
          if (!item) continue;
          if (!youtubeDestinationIds(guild, channel.channelId).length) {
            await rollbackVideo(guildId, channel.channelId, video.videoId).catch(() => undefined);
            continue;
          }
          prepared.push(item);
          claimedPrepared.push(item);
        } catch (error) {
          await rollbackVideo(guildId, channel.channelId, video.videoId).catch(() => undefined);
          await recordChannelError(guildId, channel, transientErrorMessage(error));
        }
      }
    }
    if (!prepared.length) return;
    if (shouldAbort()) {
      await rollbackPrepared(claimedPrepared);
      return;
    }
    const delivery = await deliverPrepared(client, guild, prepared, false, shouldAbort);
    const failed = delivery.states.filter(state => !state.successful).map(state => state.item);
    await rollbackPrepared(failed);
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
        const item = await prepareVideo(guild, channel, video, resolveMetadata);
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
    const delivery = await deliverPrepared(client, guild, batch.items, bypassOutbox, () => false, !bypassOutbox);
    if (batch.claimed) {
      const guildId = String(guild._id);
      for (const state of delivery.states) {
        if (!state.successful) {
          await rollbackVideo(guildId, state.item.channel.channelId, state.item.video.videoId).catch(() => undefined);
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
