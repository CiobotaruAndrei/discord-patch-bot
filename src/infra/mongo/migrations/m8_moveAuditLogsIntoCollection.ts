import type { Migration } from "./migrationTypes.js";

const m8_moveAuditLogsIntoCollection: Migration = {
  id: 8,
  name: "move-audit-logs-into-collection",
  async up(db) {
    const guilds = db.collection("guilds");
    const auditColl = db.collection("guildAuditLogs");
    const cursor = guilds.find(
      { $or: [{ botAuditLog: { $exists: true } }, { serverAuditLog: { $exists: true } }] },
      { projection: { botAuditLog: 1, serverAuditLog: 1 } }
    );
    for await (const guild of cursor) {
      const guildId = String(guild._id);
      const ops: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown>; upsert: boolean } }> = [];
      const botEntries = Array.isArray(guild.botAuditLog) ? guild.botAuditLog : [];
      for (const raw of botEntries) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as Record<string, unknown>;
        const doc = {
          guildId,
          kind: "bot",
          userId: String(entry.userId || ""),
          command: String(entry.command || ""),
          result: String(entry.result || ""),
          details: String(entry.details || ""),
          at: entry.at instanceof Date ? entry.at : new Date(String(entry.at || 0))
        };
        ops.push({ updateOne: { filter: doc, update: { $setOnInsert: doc }, upsert: true } });
      }
      const serverEntries = Array.isArray(guild.serverAuditLog) ? guild.serverAuditLog : [];
      for (const raw of serverEntries) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as Record<string, unknown>;
        const doc = {
          guildId,
          kind: "server",
          userId: String(entry.userId || ""),
          action: String(entry.action || ""),
          details: String(entry.details || ""),
          at: entry.at instanceof Date ? entry.at : new Date(String(entry.at || 0))
        };
        ops.push({ updateOne: { filter: doc, update: { $setOnInsert: doc }, upsert: true } });
      }
      if (ops.length) await auditColl.bulkWrite(ops, { ordered: false });
      await guilds.updateOne({ _id: guild._id }, { $unset: { botAuditLog: "", serverAuditLog: "" } });
    }
  }
};

export { m8_moveAuditLogsIntoCollection };
