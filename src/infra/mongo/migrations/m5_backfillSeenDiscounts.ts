import type { Migration } from "./migrationTypes.js";

const m5_backfillSeenDiscounts: Migration = {
  id: 5,
  name: "backfill-seenDiscounts-into-collection",
  async up(db) {
    const guilds = db.collection("guilds");
    const seenColl = db.collection("guildSeenDiscounts");
    const cursor = guilds.find(
      { seenDiscounts: { $exists: true, $ne: [] } },
      { projection: { seenDiscounts: 1 } }
    );
    for await (const guild of cursor) {
      const hashes = Array.isArray(guild.seenDiscounts) ? guild.seenDiscounts : [];
      if (!hashes.length) continue;
      const ops = hashes
        .filter((h: unknown) => typeof h === "string" && h.length > 0)
        .map((h: string) => ({
          updateOne: {
            filter: { guildId: String(guild._id), dealHash: h },
            update: { $setOnInsert: { guildId: String(guild._id), dealHash: h, seenAt: new Date() } },
            upsert: true
          }
        }));
      if (ops.length) await seenColl.bulkWrite(ops, { ordered: false });
    }
  }
};

export { m5_backfillSeenDiscounts };
