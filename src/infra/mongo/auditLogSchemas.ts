import type * as Mongoose from "mongoose";
import type { RuntimeEnv } from "../../types.js";

export interface AuditLogSchemasDeps {
  mongoose: typeof Mongoose;
  ONE_DAY_MS: number;
  env: RuntimeEnv;
}

export function buildAuditLogSchemas({ mongoose, ONE_DAY_MS, env }: AuditLogSchemasDeps) {
  const GUILD_AUDIT_LOG_TTL_DAYS = env.GUILD_AUDIT_LOG_TTL_DAYS;
  const guildAuditLogSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    kind: { type: String, enum: ["bot", "server"], required: true },
    userId: { type: String, default: "" },
    command: { type: String, default: "" },
    action: { type: String, default: "" },
    result: { type: String, default: "" },
    details: { type: String, default: "" },
    at: { type: Date, default: Date.now, expires: GUILD_AUDIT_LOG_TTL_DAYS * ONE_DAY_MS / 1000 }
  }, { minimize: false });
  guildAuditLogSchema.index({ guildId: 1, kind: 1, at: -1 }, { background: true });

  return { guildAuditLogSchema };
}
