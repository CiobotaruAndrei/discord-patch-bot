import test from "node:test";
import assert from "node:assert/strict";

import {
  applyResourceIdRemap,
  collectBackupResourceReferences,
  planBackupResourceRestore,
  validateBackupResourceReferences
} from "../../features/admin-records/backupResourceRestorePlan.js";

test("planul include canale, roluri si toate caile YouTube, cu deduplicare dupa resursa", () => {
  const snapshot = {
    notificationChannelId: "channel-existing",
    discountChannelId: "channel-shared",
    notificationRoleId: "role-missing",
    youtubeChannelRoutes: [
      { channelId: "source-a", discordChannelIds: ["channel-shared", "channel-existing"] },
      { channelId: "source-b", discordChannelIds: ["channel-shared"] }
    ]
  };

  const plan = planBackupResourceRestore(snapshot, ["channel-existing"], []);

  assert.deepEqual(plan.present.map(entry => entry.oldId), ["channel-existing"]);
  assert.deepEqual(plan.missing.map(entry => entry.oldId).sort(), ["channel-shared", "role-missing"]);
  const shared = plan.missing.find(entry => entry.oldId === "channel-shared");
  assert.equal(shared?.references.length, 3, "top-level plus aparitiile imbricate folosesc aceeasi resursa");
  assert.deepEqual(shared?.references.map(reference => reference.path), [
    "discountChannelId",
    "youtubeChannelRoutes[0].discordChannelIds[0]",
    "youtubeChannelRoutes[1].discordChannelIds[0]"
  ]);
});

test("remaparea este imutabila si inlocuieste toate aparitiile fara sa schimbe ordinea rutelor", () => {
  const snapshot = {
    notificationChannelId: "old-channel",
    notificationRoleId: "old-role",
    youtubeChannelRoutes: [
      { channelId: "source-a", discordChannelIds: ["old-channel", "other-channel"] },
      { channelId: "source-b", discordChannelIds: ["old-channel", "old-channel"] }
    ]
  };

  const restored = applyResourceIdRemap(snapshot, {
    channels: new Map([["old-channel", "new-channel"]]),
    roles: new Map([["old-role", "new-role"]])
  });

  assert.equal(restored.notificationChannelId, "new-channel");
  assert.equal(restored.notificationRoleId, "new-role");
  const routes = restored.youtubeChannelRoutes;
  assert.ok(Array.isArray(routes));
  assert.deepEqual(routes, [
    { channelId: "source-a", discordChannelIds: ["new-channel", "other-channel"] },
    { channelId: "source-b", discordChannelIds: ["new-channel", "new-channel"] }
  ]);
  assert.equal(snapshot.notificationChannelId, "old-channel");
  assert.deepEqual(snapshot.youtubeChannelRoutes[0].discordChannelIds, ["old-channel", "other-channel"]);
});

test("referintele corupte sunt raportate cu calea exacta si blocheaza validarea", () => {
  const snapshot = {
    notificationRoleId: 17,
    youtubeChannelRoutes: [
      { channelId: "source-a", discordChannelIds: ["", 42] },
      "broken-route",
      { channelId: "source-b", discordChannelIds: "broken-list" }
    ]
  };

  const collected = collectBackupResourceReferences(snapshot);
  const validation = validateBackupResourceReferences(snapshot, [], []);

  assert.equal(collected.entries.length, 0);
  assert.deepEqual(validation.invalid.map(item => item.path), [
    "notificationRoleId",
    "youtubeChannelRoutes[0].discordChannelIds[0]",
    "youtubeChannelRoutes[0].discordChannelIds[1]",
    "youtubeChannelRoutes[1]",
    "youtubeChannelRoutes[2].discordChannelIds"
  ]);
});

test("snapshot-ul fara resurse produce plan gol", () => {
  assert.deepEqual(planBackupResourceRestore({ subscribed: true }, [], []), {
    invalid: [],
    missing: [],
    present: []
  });
});
