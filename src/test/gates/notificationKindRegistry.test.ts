import test from "node:test";
import assert from "node:assert/strict";

import {
  loadModule,
  calls,
  callsWithin,
  comparisons,
  declaresType,
  exportedConstNames,
  importedModules,
  reExports,
  propertyValues,
  stringLiteralsWithin
} from "./sourceStructureQueries.js";

import { NOTIFICATION_KINDS, NOTIFICATION_KIND_REGISTRY, subscriptionFilterFor } from "../../shared/notificationKinds.js";

const schemas = loadModule("infra", "mongo", "outboxSchemas.ts");
const factory = loadModule("features", "notifications", "outboxRuntimeFactory.ts");
const replay = loadModule("features", "notifications", "deadLetterReplayRepository.ts");
const featureBarrel = loadModule("features", "notifications", "notificationKinds.ts");

test("schemele Mongo isi iau enum-ul de kind din registru, nu dintr-o lista scrisa de mana", () => {
  const enums = propertyValues(schemas, "kind").filter(declared => declared.includes("enum:"));
  assert.ok(enums.length > 0, "schemele declara enum-uri de kind");
  const handwritten = enums.filter(declared => !declared.includes("NOTIFICATION_KINDS"));
  assert.deepEqual(
    handwritten,
    [],
    "o lista de kind-uri scrisa in schema se desincronizeaza de registru; exact asa a ramas `dlc` in afara outbox-ului: " +
      handwritten.join(" | ")
  );
  assert.equal(
    enums.filter(declared => declared.includes("...NOTIFICATION_KINDS")).length,
    4,
    "toate cele patru colectii cu kind deriva din registru"
  );
});

test("filtrul de abonament al outbox-ului deriva din registru, fara lant de if-uri pe kind", () => {
  assert.ok(
    callsWithin(factory, "outboxSubscriptionFilter").some(call => call.callee === "subscriptionFilterFor"),
    "filtrul intreaba registrul"
  );
  const named = stringLiteralsWithin(factory, "outboxSubscriptionFilter")
    .filter(literal => (NOTIFICATION_KINDS as readonly string[]).includes(literal));
  assert.deepEqual(
    named,
    [],
    "filtrul nu mai are voie sa numeasca un kind; unul nou ar fi cazut tacut pe ramura implicita: " + named.join(", ")
  );
});

test("decodarea unui kind necunoscut trece prin registru, nu printr-un lant de ternare", () => {
  assert.ok(
    calls(replay).some(call => call.callee === "notificationKindOr"),
    "decodarea trece prin registru"
  );
  const literalChecks = comparisons(replay).filter(entry => entry.left.endsWith(".kind") && entry.right.startsWith('"'));
  assert.deepEqual(
    literalChecks,
    [],
    "compararea directa cu literale colapseaza kind-urile noi la update: " +
      literalChecks.map(entry => `linia ${entry.line}: ${entry.left} ${entry.operator} ${entry.right}`).join(" | ")
  );
});

test("fiecare kind are o poarta de abonament proprie, cu campuri distincte", () => {
  const seen = new Map<string, string>();
  for (const kind of NOTIFICATION_KINDS) {
    const gate = NOTIFICATION_KIND_REGISTRY[kind].subscription;
    const signature = `${gate.enabledField}|${gate.channelField}`;
    const owner = seen.get(signature);
    assert.equal(
      owner,
      undefined,
      `${kind} si ${owner} ar citi acelasi camp de abonament (${signature}), deci s-ar livra unul in locul celuilalt`
    );
    seen.set(signature, kind);
  }
});

test("filtrul construit pentru un kind numeste doar campurile lui", () => {
  const dlc = subscriptionFilterFor({ kind: "dlc", guildId: "g", channelId: "c" });
  assert.deepEqual(dlc, { _id: "g", dlcSubscribed: true, dlcChannelId: "c" });

  const update = subscriptionFilterFor({ kind: "update", guildId: "g", channelId: "c" });
  assert.deepEqual(update, { _id: "g", subscribed: true, notificationChannelId: "c" });

  const youtube = subscriptionFilterFor({ kind: "youtube", guildId: "g", channelId: "c" });
  assert.deepEqual(youtube, {
    _id: "g",
    youtubeNotificationsEnabled: true,
    $or: [{ youtubeNotificationChannelId: "c" }, { "youtubeChannelRoutes.discordChannelIds": "c" }]
  });

  const manualYoutube = subscriptionFilterFor({ kind: "youtube", guildId: "g", channelId: "c", manual: true });
  assert.ok(!("youtubeNotificationsEnabled" in manualYoutube), "trimiterea manuala nu cere abonamentul pornit");
});

test("registrul de kind-uri traieste in shared, ca infra si features sa poata porni din acelasi loc", () => {
  assert.ok(
    importedModules(schemas).some(module => module.endsWith("shared/notificationKinds.js")),
    "schemele Mongo pornesc din registrul comun"
  );
  assert.ok(
    reExports(featureBarrel).every(entry => entry.module.endsWith("shared/notificationKinds.js")),
    "barrel-ul din features doar re-exporta registrul comun, nu adauga o a doua sursa"
  );
  assert.ok(
    !exportedConstNames(featureBarrel).includes("NOTIFICATION_KIND_REGISTRY"),
    "features nu isi mai tine propria copie a registrului"
  );
  assert.ok(
    !declaresType(featureBarrel, "NotificationKindRegistry"),
    "nici tipul registrului nu se dubleaza in features"
  );
});
