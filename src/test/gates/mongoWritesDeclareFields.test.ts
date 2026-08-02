import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { buildOperationalSchemas } from "../../infra/mongo/operationalSchemas.js";

const schemas = buildOperationalSchemas({
  mongoose,
  ONE_DAY_MS: 86_400_000,
  env: {
    GUILD_SEEN_DISCOUNT_TTL_DAYS: 60,
    GUILD_AUDIT_LOG_TTL_DAYS: 180,
    NOTIFICATION_OUTBOX_SENT_TTL_HOURS: 24,
    NOTIFICATION_HISTORY_TTL_DAYS: 30,
    FEEDBACK_REPORT_TTL_DAYS: 90,
    NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS: 7
  }
});

const WRITTEN_FIELDS: ReadonlyArray<{ schema: keyof typeof schemas; fields: readonly string[] }> = [
  {
    schema: "protectedResourceSchema",
    fields: ["deletedDuringRaidAt", "lastRestoredAt", "recreatedFromId", "degraded", "preventionApplied", "snapshotAt"]
  },
  { schema: "raidSnapshotSchema", fields: ["snapshot", "operations", "capturedAt"] },
  { schema: "massModerationWindowSchema", fields: ["events", "sanctionedAt", "updatedAt"] },
  { schema: "webhookSnapshotSchema", fields: ["entries", "capturedAt"] }
];

test("fiecare camp scris de repozitorii este declarat in schema care il persista", () => {
  const missing: string[] = [];

  for (const entry of WRITTEN_FIELDS) {
    const schema = schemas[entry.schema];
    assert.ok(schema, `schema ${String(entry.schema)} nu exista`);
    for (const field of entry.fields) {
      if (schema.path(field) === undefined) missing.push(`${String(entry.schema)}.${field}`);
    }
  }

  assert.deepEqual(
    missing,
    [],
    "Mongoose taie campurile nedeclarate la update strict: scrierea raporteaza succes, citirea nu contine campul, "
      + "iar un model fals permisiv din teste ascunde exact acest caz"
  );
});
