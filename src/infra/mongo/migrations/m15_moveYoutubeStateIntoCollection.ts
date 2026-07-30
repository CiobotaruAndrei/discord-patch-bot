import { YOUTUBE_FIELDS } from "../../../shared/guildYoutubeFields.js";

import type { Migration } from "./migrationTypes.js";

const m15_moveYoutubeStateIntoCollection: Migration = {
  id: 15,
  name: "move-youtube-state-into-collection",
  async up(db) {
    const guilds = db.collection("guilds");
    const youtube = db.collection("guildYoutubeState");
    const projection: Record<string, number> = {};
    for (const field of YOUTUBE_FIELDS) projection[field] = 1;

    const cursor = guilds.find({ $or: YOUTUBE_FIELDS.map(field => ({ [field]: { $exists: true } })) }, { projection });
    for await (const guild of cursor) {
      const slice: Record<string, unknown> = {};
      for (const field of YOUTUBE_FIELDS) {
        if (guild[field] !== undefined) slice[field] = guild[field];
      }
      if (Object.keys(slice).length > 0) {
        await youtube.updateOne({ _id: guild._id }, { $set: slice }, { upsert: true });
      }
    }
  }
};

export { m15_moveYoutubeStateIntoCollection };
