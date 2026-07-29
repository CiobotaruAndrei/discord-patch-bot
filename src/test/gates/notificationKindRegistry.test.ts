import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

import { NOTIFICATION_KINDS, NOTIFICATION_KIND_REGISTRY, subscriptionFilterFor } from "../../shared/notificationKinds.js";

const srcRoot = process.cwd();

function read(relative: string): string {
  return fs.readFileSync(path.join(srcRoot, relative), "utf8");
}

test("schemele Mongo isi iau enum-ul de kind din registru, nu dintr-o lista scrisa de mana", () => {
  const schemas = read("infra/mongo/outboxSchemas.ts");
  const inlineEnums = schemas.match(/kind: \{ type: String, enum: \[\s*"/g) ?? [];
  assert.deepEqual(
    inlineEnums,
    [],
    "o lista de kind-uri scrisa in schema se desincronizeaza de registru; exact asa a ramas `dlc` in afara outbox-ului"
  );
  const derived = schemas.match(/kind: \{ type: String, enum: \[\.\.\.NOTIFICATION_KINDS\]/g) ?? [];
  assert.equal(derived.length, 4, "toate cele patru colectii cu kind deriva din registru");
});

test("filtrul de abonament al outbox-ului deriva din registru, fara lant de if-uri pe kind", () => {
  const factory = read("features/notifications/outboxRuntimeFactory.ts");
  const filterBlock = factory.slice(
    factory.indexOf("export function outboxSubscriptionFilter"),
    factory.indexOf("export function createIsStillSubscribed")
  );
  assert.match(filterBlock, /subscriptionFilterFor\(/);
  for (const kind of NOTIFICATION_KINDS) {
    assert.ok(
      !filterBlock.includes(`"${kind}"`),
      `filtrul nu mai are voie sa numeasca kind-ul "${kind}"; un kind nou ar fi cazut tacut pe ramura implicita`
    );
  }
});

test("decodarea unui kind necunoscut trece prin registru, nu printr-un lant de ternare", () => {
  const replay = read("features/notifications/deadLetterReplayRepository.ts");
  assert.match(replay, /notificationKindOr\(fields\.kind\)/);
  assert.ok(
    !/fields\.kind === "/.test(replay),
    "compararea directa cu literale colapseaza kind-urile noi la update"
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
  const infra = read("infra/mongo/outboxSchemas.ts");
  assert.match(infra, /from "\.\.\/\.\.\/shared\/notificationKinds\.js"/);
  const featureBarrel = read("features/notifications/notificationKinds.ts");
  assert.match(featureBarrel, /from "\.\.\/\.\.\/shared\/notificationKinds\.js"/);
  assert.ok(
    !/NOTIFICATION_KIND_REGISTRY = \{/.test(featureBarrel),
    "features nu isi mai tine propria copie a registrului"
  );
});
