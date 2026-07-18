"use strict";

import type * as Mongoose from "mongoose";

export function buildGuildOperationalFields(mongoose: typeof Mongoose): Record<string, unknown> {
  return {
    moderationTimeouts: { type: [mongoose.Schema.Types.Mixed], default: [] },
    moderationMutes: { type: [mongoose.Schema.Types.Mixed], default: [] },
    moderationWarnings: { type: [mongoose.Schema.Types.Mixed], default: [] },
    moderationWarnBanLimit: { type: Number, default: 0, min: 0 },
    playerCountSubscribed: { type: Boolean, default: false },
    playerCountChannelId: { type: String, default: null },
    playerCountGames: { type: [String], default: [] }
  };
}

export function buildGuildSecurityFields(mongoose: typeof Mongoose): Record<string, unknown> {
  return {
    newAccountAlertChannelId: { type: String, default: null },
    newAccountAlertsEnabled: { type: Boolean, default: false },
    threatAlertChannelId: { type: String, default: null },
    threatProtectionEnabled: { type: Boolean, default: false },
    botAddAlertChannelId: { type: String, default: null },
    botAddProtectionEnabled: { type: Boolean, default: false },
    botAddPermissions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    purgeAmount: { type: Number, default: 50, min: 1, max: 100 },
    lockedChannelIds: { type: [String], default: [] },
    lockedChannelPreviousSendMessages: { type: Map, of: Boolean, default: {} }
  };
}
