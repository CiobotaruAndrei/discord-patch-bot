import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const srcRoot = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(srcRoot, "infra", "mongo", rel), "utf8");

test("sub-schemele guild traiesc in module pe domenii, nu inline in models.ts", () => {
  const models = read("models.ts");
  assert.ok(!models.includes("{ _id: false }"), "models.ts nu mai defineste sub-scheme inline (toate au { _id: false } si traiesc in modulele de domeniu)");
  for (const [file, schemas] of [
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
  ] as const) {
    const text = read(file);
    for (const schema of schemas) {
      assert.ok(text.includes(`const ${schema} = new mongoose.Schema(`), `${file} detine ${schema}`);
    }
  }
  for (const builder of [
    "buildGuildNotificationSchemas({ mongoose, SUPPORTED_CURRENCIES })",
    "buildGuildYoutubeSchemas({ mongoose })",
    "buildGuildAdminRecordSchemas({ mongoose })",
    "buildOperationalSchemas({ mongoose, ONE_DAY_MS, env })",
    "buildSeenSchemas({ mongoose, ONE_DAY_MS, env })",
    "buildOutboxSchemas({ mongoose, ONE_DAY_MS, env })"
  ]) {
    assert.ok(models.includes(builder), `models.ts compune ${builder.split("(")[0]}`);
  }
});

function extractGuildSchemaFields(models: string): Set<string> {
  const start = models.indexOf("const guildSchema = new mongoose.Schema({");
  const end = models.indexOf("}, { minimize: false });", start);
  const block = models.slice(start, end);
  const fields = new Set<string>();
  for (const match of block.matchAll(/^ {4}(\w+):/gm)) {
    fields.add(match[1]);
  }
  return fields;
}

function extractGuildDocFields(modelTypes: string): Set<string> {
  const start = modelTypes.indexOf("export interface GuildDoc {");
  const end = modelTypes.indexOf("\n}", start);
  const block = modelTypes.slice(start, end);
  const fields = new Set<string>();
  for (const match of block.matchAll(/^ {2}(\w+)\??:/gm)) {
    fields.add(match[1]);
  }
  return fields;
}

test("modelTypes.GuildDoc este aliniat 1:1 cu campurile top-level din guildSchema (anti-drift)", () => {
  const schemaFields = extractGuildSchemaFields(read("models.ts"));
  const docFields = extractGuildDocFields(read("guildSettingsDocTypes.ts"));
  assert.ok(schemaFields.size > 40, `extractia de campuri din guildSchema functioneaza (${schemaFields.size} campuri)`);
  const missingInDoc = [...schemaFields].filter(field => !docFields.has(field));
  assert.deepEqual(missingInDoc, [], `campuri din guildSchema fara pereche in GuildDoc: ${missingInDoc.join(", ")}`);
  const missingInSchema = [...docFields].filter(field => !schemaFields.has(field) && field !== "_id");
  assert.deepEqual(missingInSchema, [], `campuri din GuildDoc fara pereche in guildSchema: ${missingInSchema.join(", ")}`);
});

test("modelTypes.GuildDoc reflecta si campurile noi aliniate: commandSnoozes si priceAlerts.absentCycles", () => {
  const modelTypes = read("guildSettingsDocTypes.ts");
  assert.match(modelTypes, /commandSnoozes\?: Map<string, Date> \| Record<string, Date>/, "GuildDoc declara commandSnoozes (era in schema, lipsea din tip)");
  const priceAlertsStart = modelTypes.indexOf("priceAlerts?: Array<{");
  const priceAlertsBlock = modelTypes.slice(priceAlertsStart, modelTypes.indexOf("}>;", priceAlertsStart));
  assert.match(priceAlertsBlock, /absentCycles\?: number/, "intrarea priceAlerts declara absentCycles (era in schema, lipsea din tip)");
});
