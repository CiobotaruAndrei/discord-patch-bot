import type { Migration } from "./migrationTypes.js";

interface LegacyBotAddRecord {
  requestId?: unknown;
  botId?: unknown;
  botTag?: unknown;
  requesterId?: unknown;
  reason?: unknown;
  status?: unknown;
  ownerId?: unknown;
  requestedAt?: unknown;
  respondedAt?: unknown;
  usedAt?: unknown;
  expiresAt?: unknown;
}

const KNOWN_STATUSES = new Set(["pending", "approved", "rejected", "used", "expired", "cancelled"]);

function validDate(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const m18_unifyPermissionRequests: Migration = {
  id: 18,
  name: "unify-permission-requests",
  async up(db) {
    const guilds = db.collection("guilds");
    const requests = db.collection("guildPermissionRequests");

    await guilds.updateMany(
      { botAddAlertChannelId: { $nin: [null, ""] }, permissionRequestChannelId: { $in: [null, undefined, ""] } },
      [{ $set: { permissionRequestChannelId: "$botAddAlertChannelId" } }]
    );

    const cursor = guilds.find({ "botAddPermissions.0": { $exists: true } }, { projection: { botAddPermissions: 1 } });
    for await (const guild of cursor) {
      const guildId = String(guild._id);
      const records = Array.isArray(guild.botAddPermissions) ? (guild.botAddPermissions as LegacyBotAddRecord[]) : [];
      for (const record of records) {
        const requestId = text(record.requestId);
        const botId = text(record.botId);
        const requesterId = text(record.requesterId);
        if (!requestId || !botId || !requesterId) continue;
        const status = KNOWN_STATUSES.has(text(record.status)) ? text(record.status) : "expired";
        const requestedAt = validDate(record.requestedAt) ?? new Date();
        await requests.updateOne(
          { _id: requestId },
          {
            $setOnInsert: {
              guildId,
              type: "bot-add",
              requesterId,
              target: botId,
              action: "add",
              botId,
              permissions: undefined,
              amount: null,
              reason: text(record.reason) || text(record.botTag),
              status,
              ownerId: text(record.ownerId) || null,
              requestedAt,
              respondedAt: validDate(record.respondedAt),
              usedAt: validDate(record.usedAt),
              expiresAt: validDate(record.expiresAt)
            }
          },
          { upsert: true }
        );
      }
    }
  }
};

export { m18_unifyPermissionRequests };
