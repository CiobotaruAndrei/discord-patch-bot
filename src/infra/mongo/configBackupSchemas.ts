import type * as Mongoose from "mongoose";

export interface ConfigBackupSchemasDeps {
  mongoose: typeof Mongoose;
}

export function buildConfigBackupSchemas({ mongoose }: ConfigBackupSchemasDeps) {
  const guildConfigBackupSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    name: { type: String, required: true },
    createdBy: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true }
  }, { minimize: false });
  guildConfigBackupSchema.index({ guildId: 1, name: 1 }, { unique: true, background: true });
  guildConfigBackupSchema.index({ guildId: 1, createdAt: -1 }, { background: true });

  return { guildConfigBackupSchema };
}
