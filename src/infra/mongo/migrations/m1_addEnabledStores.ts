import type { Migration } from "./migrationTypes.js";

const m1_addEnabledStores: Migration = {
  id: 1,
  name: "add-enabledStores-to-existing-guilds",
  async up(db) {
    const coll = db.collection("guilds");
    await coll.updateMany(
      { enabledStores: { $exists: false } },
      { $set: { enabledStores: [] } }
    );
  }
};

export { m1_addEnabledStores };
