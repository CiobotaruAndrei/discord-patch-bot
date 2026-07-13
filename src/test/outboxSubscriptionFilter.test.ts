import test from "node:test";
import assert from "node:assert/strict";

import notifications from "../features/notifications/index";
const { createIsStillSubscribed, outboxSubscriptionFilter } = notifications;

const youtubeJob = { guildId: "g1", channelId: "c1", kind: "youtube" as const, payload: {} };
const discountJob = { guildId: "g1", channelId: "c1", kind: "discount" as const, payload: {} };
const updateJob = { guildId: "g1", channelId: "c1", kind: "update" as const, payload: {} };

test("createIsStillSubscribed: o eroare Mongo la countDocuments se PROPAGA (fail-closed), nu mai e inghitita ca true (R21 #1)", async () => {
  const predicate = createIsStillSubscribed({ countDocuments: () => Promise.reject(new Error("mongo down")) });
  await assert.rejects(() => predicate(youtubeJob), /mongo down/, "predicate-ul lasa eroarea sa ajunga la drainOutbox (care amana livrarea), in loc sa returneze true si sa livreze orbeste");
});

test("createIsStillSubscribed: count > 0 -> abonat, count 0 -> nu (verificare reala, nu mascata)", async () => {
  const yes = createIsStillSubscribed({ countDocuments: () => Promise.resolve(1) });
  const no = createIsStillSubscribed({ countDocuments: () => Promise.resolve(0) });
  assert.equal(await yes(youtubeJob), true);
  assert.equal(await no(youtubeJob), false);
});

test("outboxSubscriptionFilter: un job YouTube MANUAL nu mai cere youtubeNotificationsEnabled (doar existenta destinatiei), R21 #2", () => {
  const manual = outboxSubscriptionFilter({ ...youtubeJob, manual: true });
  assert.equal("youtubeNotificationsEnabled" in manual, false, "manual: livrarea explicita nu depinde de comutatorul notificarilor automate");
  assert.deepEqual(manual.$or, [
    { youtubeNotificationChannelId: "c1" },
    { "youtubeChannelRoutes.discordChannelIds": "c1" }
  ], "manual: inca verifica existenta destinatiei (canal principal sau ruta)");
  assert.equal(manual._id, "g1");
});

test("outboxSubscriptionFilter: un job YouTube AUTOMAT cere in continuare youtubeNotificationsEnabled", () => {
  const auto = outboxSubscriptionFilter(youtubeJob);
  assert.equal(auto.youtubeNotificationsEnabled, true, "automat: respecta /youtube notify off (jobul nu se livreaza daca notificarile sunt oprite)");
  assert.ok(auto.$or, "automat: verifica si destinatia");
});

test("outboxSubscriptionFilter: discount si update raman neschimbate (manual nu le afecteaza)", () => {
  assert.deepEqual(outboxSubscriptionFilter(discountJob), { _id: "g1", discountsSubscribed: true, discountChannelId: "c1" });
  assert.deepEqual(outboxSubscriptionFilter(updateJob), { _id: "g1", subscribed: true, notificationChannelId: "c1" });
  assert.deepEqual(outboxSubscriptionFilter({ ...discountJob, manual: true }), { _id: "g1", discountsSubscribed: true, discountChannelId: "c1" });
});
