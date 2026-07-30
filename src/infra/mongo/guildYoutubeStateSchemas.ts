import type * as Mongoose from "mongoose";

import { YOUTUBE_FIELDS } from "../../shared/guildYoutubeFields.js";

export { YOUTUBE_FIELDS };

export interface GuildYoutubeStateSchemasDeps {
  mongoose: typeof Mongoose;
  youtubeChannelSchema: Mongoose.Schema;
  youtubeChannelRouteSchema: Mongoose.Schema;
}

export const YOUTUBE_STATE_SCHEMA_VERSION = 1;

export function buildGuildYoutubeStateSchemas({
  mongoose,
  youtubeChannelSchema,
  youtubeChannelRouteSchema
}: GuildYoutubeStateSchemasDeps) {
  const guildYoutubeStateSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    schemaVersion: { type: Number, default: YOUTUBE_STATE_SCHEMA_VERSION },
    youtubeChannels: { type: [youtubeChannelSchema], default: [] },
    youtubeNotificationChannelId: { type: String, default: null },
    youtubeNotificationsEnabled: { type: Boolean, default: false },
    youtubeHasActivated: { type: Boolean, default: false },
    youtubeFilters: {
      excludeShorts: { type: Boolean, default: true },
      excludeLives: { type: Boolean, default: true },
      excludePremieres: { type: Boolean, default: true },
      minDurationSeconds: { type: Number, default: 0, min: 0, max: 86400 }
    },
    youtubeMessageTemplate: { type: String, default: null, maxlength: 1000 },
    youtubeChannelRoutes: { type: [youtubeChannelRouteSchema], default: [] },
    youtubeTitleIncludeWords: { type: [String], default: [] }
  }, { versionKey: false, timestamps: true, minimize: false });

  guildYoutubeStateSchema.index(
    { youtubeNotificationsEnabled: 1, youtubeNotificationChannelId: 1 },
    { background: true }
  );

  return { guildYoutubeStateSchema };
}
