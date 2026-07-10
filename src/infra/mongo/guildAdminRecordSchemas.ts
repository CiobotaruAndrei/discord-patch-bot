import type * as Mongoose from "mongoose";

export interface GuildAdminRecordSchemasDeps {
  mongoose: typeof Mongoose;
}

export function buildGuildAdminRecordSchemas({ mongoose }: GuildAdminRecordSchemasDeps) {
  const suggestedCommandSchema = new mongoose.Schema({
    commandName: { type: String, required: true },
    description: { type: String, required: true },
    createdBy: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now }
  }, { _id: false });

  const watchlistGameSuggestionSchema = new mongoose.Schema({
    gameName: { type: String, required: true },
    createdBy: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now }
  }, { _id: false });

  const futureReleaseGameSchema = new mongoose.Schema({
    gameName: { type: String, required: true },
    addedBy: { type: String, default: "" },
    addedAt: { type: Date, default: Date.now },
    releaseDate: { type: String, default: "" },
    preorderPrice: { type: String, default: "" }
  }, { _id: false });

  const adminCommandAccessSchema = new mongoose.Schema({
    mode: { type: String, enum: ["role", "role-or-higher"], required: true },
    roleId: { type: String, required: true },
    updatedBy: { type: String, default: "" },
    updatedAt: { type: Date, default: Date.now }
  }, { _id: false });

  return {
    suggestedCommandSchema,
    watchlistGameSuggestionSchema,
    futureReleaseGameSchema,
    adminCommandAccessSchema
  };
}
