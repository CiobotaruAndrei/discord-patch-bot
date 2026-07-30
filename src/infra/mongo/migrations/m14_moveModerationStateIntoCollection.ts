import { MODERATION_FIELDS } from "../../../shared/guildModerationFields.js";

import type { Migration } from "./migrationTypes.js";

const m14_moveModerationStateIntoCollection: Migration = {
  id: 14,
  name: "move-moderation-state-into-collection",
  async up(db) {
    const guilds = db.collection("guilds");
    const moderation = db.collection("guildModeration");
    const anyFieldPresent = MODERATION_FIELDS.map(field => ({ [field]: { $exists: true } }));
    const projection: Record<string, number> = {};
    for (const field of MODERATION_FIELDS) projection[field] = 1;

    const cursor = guilds.find({ $or: anyFieldPresent }, { projection });
    for await (const guild of cursor) {
      const slice: Record<string, unknown> = {};
      for (const field of MODERATION_FIELDS) {
        if (guild[field] !== undefined) slice[field] = guild[field];
      }
      if (Object.keys(slice).length > 0) {
        await moderation.updateOne({ _id: guild._id }, { $set: slice }, { upsert: true });
      }
      await guilds.updateOne({ _id: guild._id }, {
        $unset: {
          moderationTimeouts: "",
          moderationMutes: "",
          moderationWarnings: "",
          moderationWarnBanLimit: ""
        }
      });
    }
  }
};

export { m14_moveModerationStateIntoCollection };
