import type { Migration } from "./migrationTypes.js";

const m4_trimSeenDiscounts: Migration = {
  id: 4,
  name: "trim-runaway-seenDiscounts",
  async up(db) {
    const coll = db.collection("guilds");
    await coll.updateMany(
      { "seenDiscounts.500": { $exists: true } },
      [{ $set: { seenDiscounts: { $slice: ["$seenDiscounts", -300] } } }]
    );
  }
};

export { m4_trimSeenDiscounts };
