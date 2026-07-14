import type * as Mongoose from "mongoose";
import type { MongoModelEnv } from "./mongoModelEnv.js";

export interface SeenSchemasDeps {
  mongoose: typeof Mongoose;
  ONE_DAY_MS: number;
  env: MongoModelEnv;
}

export function buildSeenSchemas({ mongoose, ONE_DAY_MS, env }: SeenSchemasDeps) {
  const GUILD_SEEN_DISCOUNT_TTL_DAYS = env.GUILD_SEEN_DISCOUNT_TTL_DAYS;
  const guildSeenDiscountSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    dealHash: { type: String, required: true },
    seenAt: { type: Date, default: Date.now, expires: GUILD_SEEN_DISCOUNT_TTL_DAYS * ONE_DAY_MS / 1000 }
  }, { minimize: false });
  guildSeenDiscountSchema.index({ guildId: 1, dealHash: 1 }, { unique: true, background: true });

  const guildSeenUpdateSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    gameKey: { type: String, required: true },
    updateId: { type: String, required: true },
    seenAt: { type: Date, default: Date.now }
  }, { minimize: false });
  guildSeenUpdateSchema.index({ guildId: 1, gameKey: 1, updateId: 1 }, { unique: true, background: true });

  const guildSeenYoutubeSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    channelId: { type: String, required: true },
    videoId: { type: String, required: true },
    seenAt: { type: Date, default: Date.now }
  }, { minimize: false });
  guildSeenYoutubeSchema.index({ guildId: 1, channelId: 1, videoId: 1 }, { unique: true, background: true });

  return { guildSeenDiscountSchema, guildSeenUpdateSchema, guildSeenYoutubeSchema };
}
