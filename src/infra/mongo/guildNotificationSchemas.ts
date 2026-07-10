import type * as Mongoose from "mongoose";
import type { CurrencyRegistry } from "../../types";

export interface GuildNotificationSchemasDeps {
  mongoose: typeof Mongoose;
  SUPPORTED_CURRENCIES: CurrencyRegistry;
}

export function buildGuildNotificationSchemas({ mongoose, SUPPORTED_CURRENCIES }: GuildNotificationSchemasDeps) {
  const pendingUpdateSchema = new mongoose.Schema({
    id: { type: String, required: true },
    title: { type: String, default: "" },
    link: { type: String, default: "" },
    excerpt: { type: String, default: "" },
    thumbnail: { type: String, default: null },
    image: { type: String, default: null },
    timestamp: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
    attempts: { type: Number, default: 0 }
  }, { _id: false });

  const pendingDiscountSchema = new mongoose.Schema({
    hash: { type: String, required: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    lastSeenAt: { type: Date, default: Date.now },
    attempts: { type: Number, default: 0 }
  }, { _id: false });

  const priceAlertSchema = new mongoose.Schema({
    gameKey: { type: String, required: true },
    gameName: { type: String, required: true },
    appId: { type: String, default: "" },
    aliases: { type: [String], default: [] },
    threshold: { type: Number, required: true, min: 0.01, max: 10000 },
    currency: { type: String, enum: Object.keys(SUPPORTED_CURRENCIES), required: true },
    triggeredAt: { type: Date, default: null },
    lastObservedPrice: { type: Number, default: null },
    lastObservedAt: { type: Date, default: null },
    absentCycles: { type: Number, default: 0 }
  }, { _id: false });

  return { pendingUpdateSchema, pendingDiscountSchema,  priceAlertSchema };
}
