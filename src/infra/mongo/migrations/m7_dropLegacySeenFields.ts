import type { Migration } from "./migrationTypes.js";

const m7_dropLegacySeenFields: Migration = {
  id: 7,
  name: "drop-legacy-seen-fields-from-guilds",
  async up(db) {
    const guilds = db.collection("guilds");
    await guilds.updateMany(
      { $or: [{ seen: { $exists: true } }, { seenDiscounts: { $exists: true } }] },
      { $unset: { seen: "", seenDiscounts: "" } }
    );
  }
};

export { m7_dropLegacySeenFields };
