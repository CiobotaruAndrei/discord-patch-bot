import type { Migration } from "./migrationTypes.js";

const m12_moveDeadLettersIntoCollection: Migration = {
  id: 12,
  name: "move-dead-letters-into-collection",
  async up(db) {
    const guilds = db.collection("guilds");
    const deadLetterColl = db.collection("guildDeadLetters");
    const cursor = guilds.find(
      { notificationDeadLetter: { $exists: true } },
      { projection: { notificationDeadLetter: 1 } }
    );
    for await (const guild of cursor) {
      const guildId = String(guild._id);
      const ops: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown>; upsert: boolean } }> = [];
      const entries = Array.isArray(guild.notificationDeadLetter) ? guild.notificationDeadLetter : [];
      for (const raw of entries) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as Record<string, unknown>;
        const kind = String(entry.kind || "");
        if (kind !== "update" && kind !== "discount" && kind !== "youtube") continue;
        const doc = {
          guildId,
          kind,
          itemId: String(entry.itemId || ""),
          title: String(entry.title || ""),
          channelId: String(entry.channelId || ""),
          dedupeKey: String(entry.dedupeKey || ""),
          reason: String(entry.reason || ""),
          attempts: Number(entry.attempts) || 0,
          failedAt: entry.failedAt instanceof Date ? entry.failedAt : new Date(String(entry.failedAt || 0))
        };
        ops.push({ updateOne: { filter: doc, update: { $setOnInsert: doc }, upsert: true } });
      }
      if (ops.length) await deadLetterColl.bulkWrite(ops, { ordered: false });
      await guilds.updateOne({ _id: guild._id }, { $unset: { notificationDeadLetter: "" } });
    }
  }
};

export { m12_moveDeadLettersIntoCollection };
