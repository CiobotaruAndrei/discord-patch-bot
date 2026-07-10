import type * as Mongoose from "mongoose";

export interface GuildYoutubeSchemasDeps {
  mongoose: typeof Mongoose;
}

export function buildGuildYoutubeSchemas({ mongoose }: GuildYoutubeSchemasDeps) {
  const youtubeLastErrorSchema = new mongoose.Schema({
    message: { type: String, default: "" },
    channelId: { type: String, default: null },
    at: { type: Date, default: null }
  }, { _id: false });

  const youtubeChannelSchema = new mongoose.Schema({
    channelId: { type: String, required: true },
    channelName: { type: String, required: true },
    channelUrl: { type: String, required: true },
    subscribedAt: { type: Date, default: Date.now },
    lastCheckedAt: { type: Date, default: null },
    lastVideoId: { type: String, default: "" },
    lastError: { type: youtubeLastErrorSchema, default: () => ({}) }
  }, { _id: false });

  const youtubeChannelRouteSchema = new mongoose.Schema({
    channelId: { type: String, required: true },
    discordChannelIds: { type: [String], default: [] }
  }, { _id: false });

  return { youtubeLastErrorSchema, youtubeChannelSchema, youtubeChannelRouteSchema };
}
