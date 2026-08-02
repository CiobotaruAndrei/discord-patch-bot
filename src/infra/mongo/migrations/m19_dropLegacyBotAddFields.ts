import type { Migration } from "./migrationTypes.js";

const m19_dropLegacyBotAddFields: Migration = {
  id: 19,
  name: "drop-legacy-bot-add-fields",
  async up(db) {
    const guilds = db.collection("guilds");

    await guilds.updateMany(
      { botAddProtectionEnabled: true, moderationGuardEnabled: { $ne: true } },
      { $set: { moderationGuardEnabled: true } }
    );

    await guilds.updateMany(
      {
        $or: [
          { botAddAlertChannelId: { $exists: true } },
          { botAddProtectionEnabled: { $exists: true } },
          { botAddPermissions: { $exists: true } }
        ]
      },
      { $unset: { botAddAlertChannelId: "", botAddProtectionEnabled: "", botAddPermissions: "" } }
    );
  }
};

export { m19_dropLegacyBotAddFields };
