import test from "node:test";
import assert from "node:assert/strict";

import {
  loadModule,
  calls,
  constructedVariables,
  constructorArgumentProperties,
  nestedMembers,
  topLevelMembersOf
} from "./sourceStructureQueries.js";

const models = loadModule("infra", "mongo", "models.ts");
const docTypes = loadModule("infra", "mongo", "guildSettingsDocTypes.ts");

const DOMAIN_SCHEMAS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["guildNotificationSchemas.ts", ["pendingUpdateSchema", "pendingDiscountSchema", "priceAlertSchema"]],
  ["guildYoutubeSchemas.ts", ["youtubeLastErrorSchema", "youtubeChannelSchema", "youtubeChannelRouteSchema"]],
  ["guildAdminRecordSchemas.ts", ["watchlistGameSuggestionSchema", "futureReleaseGameSchema", "adminCommandAccessSchema"]],
  ["auditLogSchemas.ts", ["guildAuditLogSchema"]],
  ["configBackupSchemas.ts", ["guildConfigBackupSchema"]],
  ["suggestedCommandSchemas.ts", ["guildSuggestedCommandSchema"]],
  ["youtubeErrorLogSchemas.ts", ["guildYoutubeErrorSchema"]],
  ["deadLetterLogSchemas.ts", ["guildDeadLetterSchema"]],
  ["operationalSchemas.ts", ["circuitBreakerSchema", "systemSchema", "jobLockSchema", "adminAlertCooldownSchema", "fetchSnapshotSchema", "playerCountSnapshotSchema", "feedbackReportSchema"]],
  ["seenSchemas.ts", ["guildSeenDiscountSchema", "guildSeenUpdateSchema", "guildSeenYoutubeSchema"]],
  ["outboxSchemas.ts", ["outboxHistoryEntrySchema", "notificationOutboxSchema", "notificationOutboxSentSchema", "notificationHistorySchema", "deadLetterReplaySchema"]]
];

const BUILDERS = [
  "buildGuildNotificationSchemas",
  "buildGuildYoutubeSchemas",
  "buildGuildAdminRecordSchemas",
  "buildOperationalSchemas",
  "buildSeenSchemas",
  "buildOutboxSchemas"
];

test("fiecare sub-schema guild traieste in modulul domeniului ei, nu inline in models.ts", () => {
  for (const [file, schemas] of DOMAIN_SCHEMAS) {
    const query = loadModule("infra", "mongo", file);
    const declared = constructedVariables(query, "mongoose.Schema");
    const missing = schemas.filter(schema => !declared.includes(schema));
    assert.deepEqual(missing, [], `${file} detine ${schemas.join(", ")}; lipsesc: ${missing.join(", ")}`);
  }
});

test("models.ts compune modulele de domeniu in loc sa redefineasca sub-schemele", () => {
  const invoked = new Set(calls(models).map(call => call.callee));
  const missing = BUILDERS.filter(builder => !invoked.has(builder));
  assert.deepEqual(
    missing,
    [],
    "un builder necompus inseamna ca schema domeniului a fost rescrisa inline: " + missing.join(", ")
  );
});

test("GuildDoc e aliniat 1:1 cu campurile top-level din guildSchema (anti-drift)", () => {
  const schemaFields = constructorArgumentProperties(models, "guildSchema");
  const docFields = topLevelMembersOf(docTypes, "GuildDoc").map(member => member.name);
  assert.ok(
    schemaFields.length > 40,
    `interogarea campurilor din guildSchema functioneaza (${schemaFields.length} campuri gasite)`
  );

  const missingInDoc = schemaFields.filter(field => !docFields.includes(field));
  assert.deepEqual(missingInDoc, [], `campuri din guildSchema fara pereche in GuildDoc: ${missingInDoc.join(", ")}`);
  const missingInSchema = docFields.filter(field => !schemaFields.includes(field) && field !== "_id");
  assert.deepEqual(missingInSchema, [], `campuri din GuildDoc fara pereche in guildSchema: ${missingInSchema.join(", ")}`);
});

test("campurile aliniate tarziu raman declarate in tip, nu doar in schema", () => {
  const commandSnoozes = topLevelMembersOf(docTypes, "GuildDoc").find(member => member.name === "commandSnoozes");
  assert.ok(commandSnoozes, "GuildDoc declara commandSnoozes (era in schema, lipsea din tip)");
  assert.ok(
    commandSnoozes.type.includes("Map<string, Date>"),
    "tipul lui commandSnoozes ramane cel real al schemei, nu unul aproximativ: " + commandSnoozes.type
  );
  const priceAlertFields = nestedMembers(docTypes, "GuildDoc", "priceAlerts").map(member => member.name);
  assert.ok(
    priceAlertFields.includes("absentCycles"),
    "intrarea priceAlerts declara absentCycles (era in schema, lipsea din tip): " + priceAlertFields.join(", ")
  );
});
