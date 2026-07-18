import type * as Mongoose from "mongoose";

export interface DeadLetterLogSchemasDeps {
  mongoose: typeof Mongoose;
}

export function buildDeadLetterLogSchemas({ mongoose }: DeadLetterLogSchemasDeps) {
  const guildDeadLetterSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    kind: { type: String, enum: ["update", "discount", "youtube", "future-release"], required: true },
    itemId: { type: String, default: "" },
    title: { type: String, default: "" },
    channelId: { type: String, default: "" },
    dedupeKey: { type: String, default: "" },
    reason: { type: String, default: "" },
    attempts: { type: Number, default: 0 },
    failedAt: { type: Date, default: Date.now }
  }, { minimize: false });
  guildDeadLetterSchema.index({ guildId: 1, failedAt: -1 }, { background: true });

  return { guildDeadLetterSchema };
}
