import type { Migration } from "./migrationTypes.js";

const m10_moveSuggestedCommandsIntoCollection: Migration = {
  id: 10,
  name: "move-suggested-commands-into-collection",
  async up(db) {
    const guilds = db.collection("guilds");
    const suggestedColl = db.collection("guildSuggestedCommands");
    const cursor = guilds.find(
      { suggestedCommands: { $exists: true } },
      { projection: { suggestedCommands: 1 } }
    );
    for await (const guild of cursor) {
      const guildId = String(guild._id);
      const ops: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown>; upsert: boolean } }> = [];
      const entries = Array.isArray(guild.suggestedCommands) ? guild.suggestedCommands : [];
      for (const raw of entries) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as Record<string, unknown>;
        const commandName = String(entry.commandName || "");
        if (!commandName) continue;
        const doc = {
          guildId,
          commandName,
          description: String(entry.description || ""),
          createdBy: String(entry.createdBy || ""),
          createdAt: entry.createdAt instanceof Date ? entry.createdAt : new Date(String(entry.createdAt || 0))
        };
        ops.push({ updateOne: { filter: { guildId, commandName }, update: { $setOnInsert: doc }, upsert: true } });
      }
      if (ops.length) await suggestedColl.bulkWrite(ops, { ordered: false });
      await guilds.updateOne({ _id: guild._id }, { $unset: { suggestedCommands: "" } });
    }
  }
};

export { m10_moveSuggestedCommandsIntoCollection };
