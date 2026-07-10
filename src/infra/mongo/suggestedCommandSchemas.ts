import type * as Mongoose from "mongoose";

export interface SuggestedCommandSchemasDeps {
  mongoose: typeof Mongoose;
}

export function buildSuggestedCommandSchemas({ mongoose }: SuggestedCommandSchemasDeps) {
  const guildSuggestedCommandSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    commandName: { type: String, required: true },
    description: { type: String, default: "" },
    createdBy: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now }
  }, { minimize: false });
  guildSuggestedCommandSchema.index({ guildId: 1, commandName: 1 }, { unique: true, background: true });
  guildSuggestedCommandSchema.index({ guildId: 1, createdAt: -1 }, { background: true });

  return { guildSuggestedCommandSchema };
}
