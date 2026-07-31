import test from "node:test";
import assert from "node:assert/strict";

import { MODERATION_FIELDS } from "../../features/moderation/moderationStore.js";
import { SECURITY_FIELDS } from "../../shared/guildSecurityFields.js";
import { updateTouchesSlice, sliceOf } from "../../shared/guildDomainSliceStore.js";
import { deriveCommandDomainKeys } from "../../features/command-registry/commandDomainKeys.js";

import { loadModule, calls, callsWithin, functionNames, importedModules, membersOf } from "./sourceStructureQueries.js";

const models = loadModule("infra", "mongo", "models.ts");
const mongoContext = loadModule("infra", "mongo", "mongoContext.ts");
const securityHandler = loadModule("features", "command-handlers", "securityInteractionHandler.ts");
const moderationHandler = loadModule("features", "command-handlers", "moderationInteractionHandler.ts");
const moderationStore = loadModule("features", "moderation", "moderationStore.ts");
const securityStore = loadModule("features", "command-security", "securityStore.ts");
const domainKeys = loadModule("features", "command-registry", "commandDomainKeys.ts");

test("fiecare domeniu scos din documentul Guild are colectia lui, pe un nume propriu", () => {
  const collections = calls(models)
    .filter(call => call.callee === "mongoose.model")
    .map(call => call.args[2])
    .filter((name): name is string => typeof name === "string");
  for (const collection of ['"guildModeration"', '"guildSecurity"']) {
    assert.ok(collections.includes(collection), `colectia ${collection} e declarata explicit, nu lasata pe pluralizarea implicita`);
  }
});

test("modelele dedicate ajung pana la handler-e, nu se opresc in infrastructura", () => {
  const exposed = membersOf(mongoContext, "MongoRuntimeContext").map(member => member.name);
  for (const model of ["GuildModerationModel", "GuildSecurityModel"]) {
    assert.ok(exposed.includes(model), `${model} e expus de contextul Mongo, altfel nu ajunge in contextul de comenzi`);
  }
  for (const model of ["GuildModerationModel", "GuildSecurityModel"]) {
    assert.ok(
      deriveCommandDomainKeys().admin.includes(model),
      `${model} e in lista de chei a domeniului admin; fara el, selectorul de dependinte nu il paseaza handler-ului`
    );
  }
  const mirrored = calls(mongoContext).length;
  assert.ok(mirrored > 0, "contextul Mongo isi compune exporturile prin apeluri, nu prin mutatie");
});

test("handler-ele compun fatada domeniului cand modelul dedicat exista", () => {
  const securityComposition = callsWithin(securityHandler, "buildSecurityCommandHandler").map(call => call.callee);
  assert.ok(
    securityComposition.includes("createSecurityStore"),
    "handler-ul de securitate compune fatada, altfel colectia dedicata ar rămâne goala in productie"
  );
  const moderationComposition = callsWithin(moderationHandler, "createModerationInteractionHandler").map(call => call.callee);
  assert.ok(moderationComposition.includes("createModerationStore"), "handler-ul de moderare compune fatada lui");
});

test("logica de oglindire are un singur loc: modulul comun din shared", () => {
  assert.ok(
    importedModules(moderationStore).some(module => module.includes("shared/guildDomainSliceStore")),
    "fatada de moderare deleaga la magazinul comun"
  );
  assert.ok(
    importedModules(securityStore).some(module => module.includes("shared/guildDomainSliceStore")),
    "fatada de securitate foloseste acelasi criteriu de potrivire a campurilor"
  );
  const duplicated = functionNames(moderationStore).filter(name => ["touchesModeration", "moderationSlice", "resolve"].includes(name));
  assert.deepEqual(duplicated, [], "criteriul de potrivire nu mai are o a doua copie in fatada de moderare");
});

test("domeniile scoase din Guild nu se suprapun", () => {
  const overlap = MODERATION_FIELDS.filter(field => (SECURITY_FIELDS as readonly string[]).includes(field));
  assert.deepEqual(overlap, [], "un camp revendicat de doua colectii ar avea doi proprietari si doua surse de adevar");
});

test("criteriul de potrivire acopera formele reale de update, nu doar $set simplu", () => {
  assert.equal(updateTouchesSlice(SECURITY_FIELDS, { $set: { threatProtectionEnabled: true } }), true, "$set direct");
  assert.equal(updateTouchesSlice(SECURITY_FIELDS, { $addToSet: { lockedChannelIds: "c1" } }), true, "mutatie de array");
  assert.equal(
    updateTouchesSlice(SECURITY_FIELDS, { $set: { "lockedChannelPermissions.0.sendMessages": "deny" } }),
    true,
    "cale cu punct: radacina e ce conteaza"
  );
  assert.equal(
    updateTouchesSlice(SECURITY_FIELDS, [{ $set: { botAddPermissions: [] } }]),
    true,
    "pipeline de agregare, forma folosita de oprirea protectiei bot-add"
  );
  assert.equal(updateTouchesSlice(SECURITY_FIELDS, { $set: { timezone: "UTC" } }), false, "o setare care nu e de securitate nu declanseaza oglindirea");
  assert.equal(
    updateTouchesSlice(SECURITY_FIELDS, { $set: { threatProtectionEnabledExtra: true } }),
    false,
    "potrivirea e pe cheie intreaga, nu pe prefix"
  );
});

test("felia extrasa contine doar campurile prezente, nu chei cu undefined", () => {
  const slice = sliceOf(SECURITY_FIELDS, { threatProtectionEnabled: false, timezone: "UTC" });
  assert.deepEqual(slice, { threatProtectionEnabled: false }, "false e o valoare, nu o absenta");
  assert.deepEqual(sliceOf(SECURITY_FIELDS, null), {}, "un document lipsa da o felie goala, nu aruncă");
});
