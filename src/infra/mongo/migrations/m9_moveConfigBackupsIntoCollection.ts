import type { Migration } from "./migrationTypes.js";

const m9_moveConfigBackupsIntoCollection: Migration = {
  id: 9,
  name: "move-config-backups-into-collection",
  async up(db) {
    const guilds = db.collection("guilds");
    const backupColl = db.collection("guildConfigBackups");
    const cursor = guilds.find(
      { configBackups: { $exists: true } },
      { projection: { configBackups: 1 } }
    );
    for await (const guild of cursor) {
      const guildId = String(guild._id);
      const ops: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown>; upsert: boolean } }> = [];
      const backups = Array.isArray(guild.configBackups) ? guild.configBackups : [];
      for (const raw of backups) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as Record<string, unknown>;
        const name = String(entry.name || "");
        if (!name) continue;
        const doc = {
          guildId,
          name,
          createdBy: String(entry.createdBy || ""),
          createdAt: entry.createdAt instanceof Date ? entry.createdAt : new Date(String(entry.createdAt || 0)),
          snapshot: entry.snapshot && typeof entry.snapshot === "object" ? entry.snapshot : {}
        };
        ops.push({ updateOne: { filter: { guildId, name }, update: { $setOnInsert: doc }, upsert: true } });
      }
      if (ops.length) await backupColl.bulkWrite(ops, { ordered: false });
      await guilds.updateOne({ _id: guild._id }, { $unset: { configBackups: "" } });
    }
  }
};

export { m9_moveConfigBackupsIntoCollection };
