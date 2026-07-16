import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { buildGuildModerationSchemas, BOT_ADD_PERMISSION_STATUSES, MODERATION_RECORD_SCHEMA_VERSION } from "../../infra/mongo/guildModerationSchemas.js";

const { moderationRecordSchema, warningRecordSchema, botAddPermissionSchema } = buildGuildModerationSchemas({ mongoose });

test("sub-schemele de moderare sunt tipate si versionate, nu Mixed (review nou, Mediu #12)", () => {
  for (const [name, schema, requiredDate] of [
    ["moderationRecord", moderationRecordSchema, "appliedAt"],
    ["warningRecord", warningRecordSchema, "warnedAt"]
  ] as const) {
    assert.equal(schema.path("userId")?.isRequired, true, `${name}.userId e camp obligatoriu tipat`);
    assert.equal(schema.path(requiredDate)?.instance, "Date", `${name}.${requiredDate} e Date, nu Mixed`);
    assert.equal(schema.path("schemaVersion")?.options.default, MODERATION_RECORD_SCHEMA_VERSION, `${name} poarta versiunea de schema`);
    assert.equal(schema.path("reason")?.instance, "String", `${name}.reason e String`);
  }
});

test("sub-schema botAddPermissions valideaza statusul printr-un enum inchis (review nou, Mediu #12)", () => {
  const statusPath = botAddPermissionSchema.path("status");
  assert.equal(statusPath?.isRequired, true, "status e obligatoriu");
  assert.deepEqual(statusPath?.options.enum, BOT_ADD_PERMISSION_STATUSES, "statusul accepta doar valorile din ciclul de viata al cererii");
  for (const field of ["requestId", "botId", "requesterId"]) {
    assert.equal(botAddPermissionSchema.path(field)?.isRequired, true, `${field} e obligatoriu`);
  }
  assert.equal(botAddPermissionSchema.path("requestedAt")?.instance, "Date");
});

test("intrarile legacy (fara schemaVersion) raman valide - campurile noi sunt aditive", () => {
  const LegacyProbeModel = mongoose.models.LegacyModerationProbe
    ?? mongoose.model("LegacyModerationProbe", new mongoose.Schema({ entries: { type: [moderationRecordSchema], default: [] } }));
  const doc = new LegacyProbeModel({ entries: [{ userId: "u1", appliedAt: new Date() }] });
  const err = doc.validateSync();
  assert.equal(err, undefined, "o intrare legacy minimala trece validarea (username/moderatorId au default, reason e optional)");
  assert.equal(doc.entries[0]?.schemaVersion, MODERATION_RECORD_SCHEMA_VERSION, "versiunea de schema se completeaza cu default-ul curent");
});
