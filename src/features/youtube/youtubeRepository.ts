import type { LoggerFunction, YouTubeChannelSubscription, YouTubeVideo } from "../../types";

interface MongoWriteResult {
  matchedCount?: number;
  modifiedCount?: number;
  upsertedCount?: number;
}

interface GuildModelLike {
  updateOne(filter: object, update: object, options?: object): Promise<MongoWriteResult>;
}

interface SeenYoutubeModelLike {
  create(doc: object): Promise<object>;
  bulkWrite(operations: object[], options?: object): Promise<object>;
  deleteOne(filter: object): Promise<object>;
  deleteMany(filter: object): Promise<object>;
}

type WithMongoRetry = <T>(
  fn: () => Promise<T>,
  options?: { label?: string; retries?: number }
) => Promise<T>;

interface YouTubeRepositoryDeps {
  GuildModel: GuildModelLike;
  GuildSeenYoutubeModel: SeenYoutubeModelLike;
  withMongoRetry: WithMongoRetry;
  invalidateGuildCache(guildId: string): void;
  adminAlert(kind: string, title: string, body: string, guildId?: string): Promise<void>;
  logger: LoggerFunction;
}

interface DuplicateKeyError {
  code?: number;
}

const YOUTUBE_ERROR_LIMIT = 20;

export function createYouTubeRepository(deps: YouTubeRepositoryDeps) {
  const {
    GuildModel,
    GuildSeenYoutubeModel,
    withMongoRetry,
    invalidateGuildCache,
    adminAlert,
    logger
  } = deps;

  async function seedSeenVideos(guildId: string, channelId: string, videos: YouTubeVideo[]): Promise<void> {
    const uniqueIds = Array.from(new Set(videos.map(video => video.videoId).filter(Boolean)));
    if (!uniqueIds.length) return;
    const operations = uniqueIds.map(videoId => ({
      updateOne: {
        filter: { guildId, channelId, videoId },
        update: { $setOnInsert: { guildId, channelId, videoId, seenAt: new Date() } },
        upsert: true
      }
    }));
    await withMongoRetry(
      () => GuildSeenYoutubeModel.bulkWrite(operations, { ordered: false }),
      { label: "youtube:seed-seen", retries: 1 }
    );
  }

  async function claimVideo(guildId: string, channelId: string, videoId: string): Promise<boolean> {
    try {
      await withMongoRetry(
        () => GuildSeenYoutubeModel.create({ guildId, channelId, videoId, seenAt: new Date() }),
        { label: "youtube:claim", retries: 1 }
      );
      return true;
    } catch (error) {
      if ((error as DuplicateKeyError).code === 11000) return false;
      throw error;
    }
  }

  async function rollbackVideo(guildId: string, channelId: string, videoId: string): Promise<void> {
    await withMongoRetry(
      () => GuildSeenYoutubeModel.deleteOne({ guildId, channelId, videoId }),
      { label: "youtube:rollback", retries: 1 }
    );
  }

  async function removeSeenChannel(guildId: string, channelId: string): Promise<void> {
    await withMongoRetry(
      () => GuildSeenYoutubeModel.deleteMany({ guildId, channelId }),
      { label: "youtube:remove-seen", retries: 1 }
    );
  }

  async function recordChannelSuccess(
    guildId: string,
    channel: YouTubeChannelSubscription,
    newestVideoId: string
  ): Promise<void> {
    await GuildModel.updateOne(
      { _id: guildId },
      {
        $set: {
          "youtubeChannels.$[channel].lastCheckedAt": new Date(),
          "youtubeChannels.$[channel].lastVideoId": newestVideoId,
          "youtubeChannels.$[channel].lastError": { message: "", channelId: null, at: null }
        }
      },
      { arrayFilters: [{ "channel.channelId": channel.channelId }] }
    );
    invalidateGuildCache(guildId);
  }

  async function recordChannelError(
    guildId: string,
    channel: YouTubeChannelSubscription,
    message: string
  ): Promise<void> {
    const at = new Date();
    await GuildModel.updateOne(
      { _id: guildId },
      {
        $set: {
          "youtubeChannels.$[channel].lastCheckedAt": at,
          "youtubeChannels.$[channel].lastError": {
            message: message.slice(0, 500),
            channelId: channel.channelId,
            at
          }
        },
        $push: {
          youtubeErrors: {
            $each: [{
              channelId: channel.channelId,
              channelName: channel.channelName,
              message: message.slice(0, 500),
              at
            }],
            $slice: -YOUTUBE_ERROR_LIMIT
          }
        }
      },
      { arrayFilters: [{ "channel.channelId": channel.channelId }] }
    );
    invalidateGuildCache(guildId);
    adminAlert(
      "youtube:source",
      `Eroare YouTube: ${channel.channelName}`,
      message,
      guildId
    ).catch(error => logger("WARN", "YOUTUBE", "Alerta administrativa YouTube a esuat", error));
  }

  async function clearErrors(guildId: string): Promise<void> {
    await GuildModel.updateOne(
      { _id: guildId },
      {
        $set: {
          youtubeErrors: [],
          "youtubeChannels.$[].lastError": { message: "", channelId: null, at: null }
        }
      }
    );
    invalidateGuildCache(guildId);
  }

  async function disableNotificationsForChannelError(
    guildId: string,
    channelId: string,
    message: string
  ): Promise<MongoWriteResult> {
    const result = await GuildModel.updateOne(
      {
        _id: guildId,
        youtubeNotificationChannelId: channelId
      },
      {
        $set: {
          youtubeNotificationsEnabled: false,
          youtubeNotificationChannelId: null
        },
        $push: {
          youtubeErrors: {
            $each: [{
              channelId: "",
              channelName: "Canal Discord notificari",
              message: message.slice(0, 500),
              at: new Date()
            }],
            $slice: -YOUTUBE_ERROR_LIMIT
          }
        }
      }
    );
    invalidateGuildCache(guildId);
    adminAlert(
      "discord:youtube-channel",
      "Notificarile YouTube au fost oprite",
      message,
      guildId
    ).catch(error => logger("WARN", "YOUTUBE", "Alerta de canal YouTube a esuat", error));
    return result;
  }

  return {
    seedSeenVideos,
    claimVideo,
    rollbackVideo,
    removeSeenChannel,
    recordChannelSuccess,
    recordChannelError,
    clearErrors,
    disableNotificationsForChannelError
  };
}
