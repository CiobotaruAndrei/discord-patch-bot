import type { Migration } from "./migrationTypes.js";

const m3_addEnabledGames: Migration = {
  id: 3,
  name: "add-enabledGames-to-existing-guilds",
  async up(db) {
    const coll = db.collection("guilds");
    await coll.updateMany(
      { enabledGames: { $exists: false } },
      { $set: { enabledGames: [] } }
    );
  }
};

export { m3_addEnabledGames };
