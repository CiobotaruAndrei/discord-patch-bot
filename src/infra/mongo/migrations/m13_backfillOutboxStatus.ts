import type { Migration } from "./migrationTypes.js";

const m13_backfillOutboxStatus: Migration = {
  id: 13,
  name: "backfillOutboxStatus",
  up: async (db) => {
    const outbox = db.collection("notificationOutbox");
    await outbox.updateMany(
      { status: { $exists: false } },
      { $set: { status: "queued", statusChangedAt: new Date() } }
    );
  }
};

export { m13_backfillOutboxStatus };
