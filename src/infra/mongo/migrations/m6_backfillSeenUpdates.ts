import type { Migration } from "./migrationTypes.js";

const m6_backfillSeenUpdates: Migration = {
  id: 6,
  name: "backfill-seen-updates-into-collection",
  async up(db) {
    const guilds = db.collection("guilds");
    const seenColl = db.collection("guildSeenUpdates");
    const cursor = guilds.find(
      { seen: { $exists: true, $ne: {} } },
      { projection: { seen: 1 } }
    );
    for await (const guild of cursor) {
      const seen = guild.seen && typeof guild.seen === "object" ? guild.seen as Record<string, unknown> : {};
      const ops: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown>; upsert: boolean } }> = [];
      for (const [gameKey, rawIds] of Object.entries(seen)) {
        const ids = Array.isArray(rawIds) ? rawIds : [];
        for (const id of ids) {
          if (typeof id !== "string" || !id) continue;
          ops.push({
            updateOne: {
              filter: { guildId: String(guild._id), gameKey, updateId: id },
              update: { $setOnInsert: { guildId: String(guild._id), gameKey, updateId: id, seenAt: new Date() } },
              upsert: true
            }
          });
        }
      }
      if (ops.length) await seenColl.bulkWrite(ops, { ordered: false });
    }
  }
};

export { m6_backfillSeenUpdates };
