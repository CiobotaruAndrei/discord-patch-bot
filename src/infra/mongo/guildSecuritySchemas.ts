import type * as Mongoose from "mongoose";

import { SECURITY_FIELDS } from "../../shared/guildSecurityFields.js";

export { SECURITY_FIELDS };

export interface GuildSecuritySchemasDeps {
  mongoose: typeof Mongoose;
  botAddPermissionSchema: Mongoose.Schema;
  botObservationSchema: Mongoose.Schema;
  lockedChannelPermissionSchema: Mongoose.Schema;
}

export const SECURITY_STATE_SCHEMA_VERSION = 1;


export function buildGuildSecuritySchemas({
  mongoose,
  botAddPermissionSchema,
  botObservationSchema,
  lockedChannelPermissionSchema
}: GuildSecuritySchemasDeps) {
  const guildSecurityStateSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    schemaVersion: { type: Number, default: SECURITY_STATE_SCHEMA_VERSION },
    newAccountAlertChannelId: { type: String, default: null },
    newAccountAlertsEnabled: { type: Boolean, default: false },
    threatAlertChannelId: { type: String, default: null },
    threatProtectionEnabled: { type: Boolean, default: false },
    botAddAlertChannelId: { type: String, default: null },
    botAddProtectionEnabled: { type: Boolean, default: false },
    warningChannelId: { type: String, default: null },
    botAddPermissions: { type: [botAddPermissionSchema], default: [] },
    botObservations: { type: [botObservationSchema], default: [] },
    purgeAmount: { type: Number, default: 50, min: 1, max: 100 },
    lockedChannelIds: { type: [String], default: [] },
    lockedChannelPermissions: { type: [lockedChannelPermissionSchema], default: [] }
  }, { versionKey: false, timestamps: true, minimize: false });

  guildSecurityStateSchema.index({ threatProtectionEnabled: 1, threatAlertChannelId: 1 }, { background: true });
  guildSecurityStateSchema.index({ botAddProtectionEnabled: 1, botAddAlertChannelId: 1 }, { background: true });
  guildSecurityStateSchema.index({ newAccountAlertsEnabled: 1, newAccountAlertChannelId: 1 }, { background: true });

  return { guildSecurityStateSchema };
}
