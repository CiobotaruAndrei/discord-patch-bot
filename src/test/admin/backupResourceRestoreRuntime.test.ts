import test from "node:test";
import assert from "node:assert/strict";

import { planBackupResourceRestore } from "../../features/admin-records/backupResourceRestorePlan.js";
import {
  materializeBackupResources,
  type BackupDiscordGuild,
  type BackupDiscordResource,
  type BackupDiscordResourceManager
} from "../../features/admin-records/backupResourceRestoreRuntime.js";

function manager(kind: string, failAt = Number.POSITIVE_INFINITY): { manager: BackupDiscordResourceManager; deleted: string[] } {
  const cache = new Map<string, BackupDiscordResource>();
  const deleted: string[] = [];
  let created = 0;
  return {
    deleted,
    manager: {
      cache,
      create: async options => {
        created++;
        if (created === failAt) throw new Error("discord create failed");
        const id = `${kind}-${created}`;
        const resource = {
          id,
          name: options.name,
          delete: async () => { deleted.push(id); cache.delete(id); }
        };
        cache.set(id, resource);
        return resource;
      }
    }
  };
}

function guild(channelFailAt = Number.POSITIVE_INFINITY, roleFailAt = Number.POSITIVE_INFINITY) {
  const channels = manager("channel", channelFailAt);
  const roles = manager("role", roleFailAt);
  const value: BackupDiscordGuild = { id: "guild-1", channels: channels.manager, roles: roles.manager };
  return { value, channels, roles };
}

test("materializarea creeaza resursele lipsa si reluarea le refoloseste dupa numele determinist", async () => {
  const fixture = guild();
  const snapshot = {
    notificationChannelId: "old-channel",
    notificationRoleId: "old-role",
    youtubeChannelRoutes: [{ channelId: "source", discordChannelIds: ["old-channel"] }]
  };
  const plan = planBackupResourceRestore(snapshot, [], []);

  const first = await materializeBackupResources(fixture.value, plan);
  const second = await materializeBackupResources(fixture.value, plan);

  assert.equal(first.created.length, 2);
  assert.equal(second.created.length, 0);
  assert.equal(first.remap.channels.get("old-channel"), second.remap.channels.get("old-channel"));
  assert.equal(first.remap.roles.get("old-role"), second.remap.roles.get("old-role"));
});

test("esecul unei creari compenseaza resursele create anterior", async () => {
  const fixture = guild(Number.POSITIVE_INFINITY, 1);
  const plan = planBackupResourceRestore({
    notificationChannelId: "old-channel",
    notificationRoleId: "old-role"
  }, [], []);

  await assert.rejects(() => materializeBackupResources(fixture.value, plan), /discord create failed/);

  assert.deepEqual(fixture.channels.deleted, ["channel-1"]);
  assert.equal([...fixture.value.channels.cache.values()].length, 0);
  assert.equal([...fixture.value.roles.cache.values()].length, 0);
});
