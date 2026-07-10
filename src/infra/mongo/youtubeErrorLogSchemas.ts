import type * as Mongoose from "mongoose";

export interface YoutubeErrorLogSchemasDeps {
  mongoose: typeof Mongoose;
}

export function buildYoutubeErrorLogSchemas({ mongoose }: YoutubeErrorLogSchemasDeps) {
  const guildYoutubeErrorSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    channelId: { type: String, default: "" },
    channelName: { type: String, default: "" },
    message: { type: String, default: "" },
    at: { type: Date, default: Date.now }
  }, { minimize: false });
  guildYoutubeErrorSchema.index({ guildId: 1, at: -1 }, { background: true });

  return { guildYoutubeErrorSchema };
}
