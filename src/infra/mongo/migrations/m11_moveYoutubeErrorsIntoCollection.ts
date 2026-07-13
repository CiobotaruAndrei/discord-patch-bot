import type { Migration } from "./migrationTypes.js";

const m11_moveYoutubeErrorsIntoCollection: Migration = {
  id: 11,
  name: "move-youtube-errors-into-collection",
  async up(db) {
    const guilds = db.collection("guilds");
    const errorColl = db.collection("guildYoutubeErrors");
    const cursor = guilds.find(
      { youtubeErrors: { $exists: true } },
      { projection: { youtubeErrors: 1 } }
    );
    for await (const guild of cursor) {
      const guildId = String(guild._id);
      const ops: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown>; upsert: boolean } }> = [];
      const entries = Array.isArray(guild.youtubeErrors) ? guild.youtubeErrors : [];
      for (const raw of entries) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as Record<string, unknown>;
        const doc = {
          guildId,
          channelId: String(entry.channelId || ""),
          channelName: String(entry.channelName || ""),
          message: String(entry.message || ""),
          at: entry.at instanceof Date ? entry.at : new Date(String(entry.at || 0))
        };
        ops.push({ updateOne: { filter: doc, update: { $setOnInsert: doc }, upsert: true } });
      }
      if (ops.length) await errorColl.bulkWrite(ops, { ordered: false });
      await guilds.updateOne({ _id: guild._id }, { $unset: { youtubeErrors: "" } });
    }
  }
};

export { m11_moveYoutubeErrorsIntoCollection };
