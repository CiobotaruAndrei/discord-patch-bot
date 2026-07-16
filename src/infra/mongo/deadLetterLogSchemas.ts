import type * as Mongoose from "mongoose";

export interface DeadLetterLogSchemasDeps {
  mongoose: typeof Mongoose;
}

export function buildDeadLetterLogSchemas({ mongoose }: DeadLetterLogSchemasDeps) {
  const persistedEnvelopeSchema = new mongoose.Schema({
    kind: { type: String, required: true },
    schemaVersion: { type: Number, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true }
  }, { _id: false, minimize: false });
  const guildDeadLetterSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    kind: { type: String, enum: ["update", "discount", "youtube"], required: true },
    itemId: { type: String, default: "" },
    title: { type: String, default: "" },
    channelId: { type: String, default: "" },
    dedupeKey: { type: String, default: "" },
    reason: { type: String, default: "" },
    payloadEnvelope: { type: persistedEnvelopeSchema, default: null },
    attempts: { type: Number, default: 0 },
    failedAt: { type: Date, default: Date.now }
  }, { minimize: false });
  guildDeadLetterSchema.index({ guildId: 1, failedAt: -1 }, { background: true });

  return { guildDeadLetterSchema };
}
