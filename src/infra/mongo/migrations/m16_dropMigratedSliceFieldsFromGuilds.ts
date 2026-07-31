import { MODERATION_FIELDS } from "../../../shared/guildModerationFields.js";
import { SECURITY_FIELDS } from "../../../shared/guildSecurityFields.js";
import { YOUTUBE_FIELDS } from "../../../shared/guildYoutubeFields.js";

import type { Migration } from "./migrationTypes.js";

const DOMAINS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["guildModeration", MODERATION_FIELDS],
  ["guildSecurity", SECURITY_FIELDS],
  ["guildYoutubeState", YOUTUBE_FIELDS]
];

const m16_dropMigratedSliceFieldsFromGuilds: Migration = {
  id: 16,
  name: "drop-migrated-slice-fields-from-guilds",
  async up(db) {
    const guilds = db.collection("guilds");
    for (const [collectionName, fields] of DOMAINS) {
      const dedicated = db.collection(collectionName);
      const projection: Record<string, number> = {};
      for (const field of fields) projection[field] = 1;
      const anyField = fields.map(field => ({ [field]: { $exists: true } }));

      const cursor = guilds.find({ $or: anyField }, { projection });
      for await (const guild of cursor) {
        const slice: Record<string, unknown> = {};
        for (const field of fields) {
          if (guild[field] !== undefined) slice[field] = guild[field];
        }
        if (Object.keys(slice).length === 0) continue;
        const copy = await dedicated.findOne({ _id: guild._id });
        const missing: Record<string, unknown> = {};
        for (const [field, value] of Object.entries(slice)) {
          if (!copy || copy[field] === undefined) missing[field] = value;
        }
        if (Object.keys(missing).length > 0) {
          await dedicated.updateOne({ _id: guild._id }, { $set: missing }, { upsert: true });
        }
      }

      const unset: Record<string, ""> = {};
      for (const field of fields) unset[field] = "";
      await guilds.updateMany({ $or: anyField }, { $unset: unset });
    }
  }
};

export { m16_dropMigratedSliceFieldsFromGuilds };
