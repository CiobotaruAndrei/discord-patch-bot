import test from "node:test";
import assert from "node:assert/strict";

import { PermissionFlagsBits } from "discord.js";

import { MAX_VERIFIED_CHANNELS, assessMuteEffect, describeMuteEffect } from "../../features/command-security/muteEffectiveness.js";
import { adaptRaidGuild } from "../../app/runtime/antiRaidGuildAdapter.js";
import { moduleContext } from "../moduleContextStub.js";
import type { AdaptableRaidGuild } from "../../app/runtime/antiRaidGuildAdapter.js";

function guildWith(options: {
  writableChannels?: readonly string[];
  channels?: readonly string[];
  unreadable?: boolean;
  withoutPermissionsIn?: boolean;
  rolePosition?: number;
}) {
  const channelIds = options.channels ?? ["c1", "c2"];
  const writable = new Set(options.writableChannels ?? []);
  const added: string[] = [];

  const target = {
    roles: {
      cache: { has: (roleId: string) => added.includes(roleId) },
      add: async (roleId: string) => { added.push(roleId); }
    },
    permissionsIn: options.withoutPermissionsIn
      ? undefined
      : (channel: unknown) => {
        const id = (channel as { id?: string }).id ?? "";
        if (options.unreadable) return null;
        return { has: (flag: bigint) => flag === PermissionFlagsBits.SendMessages && writable.has(id) };
      }
  };

  const guild = moduleContext<AdaptableRaidGuild>({
    id: "g1",
    roles: {
      everyone: { id: "everyone" },
      cache: { values: () => [{ id: "role-muted", name: "Muted", position: options.rolePosition ?? 2 }] }
    },
    channels: { cache: { values: () => channelIds.map(id => ({ id, isTextBased: () => true })) } },
    members: { fetch: async () => target, me: { roles: { highest: { position: 10 } } } }
  });

  return { guild, added };
}

test("un rol Muted care nu opreste scrisul nu e raportat ca sanctiune aplicata (N-01)", async () => {
  const setup = guildWith({ writableChannels: ["c2"] });

  const outcome = await adaptRaidGuild(setup.guild, async () => null).applySanction("raider-1", "mute", 0, "raid");

  assert.equal(outcome.applied, false, "un rol decorativ nu opreste participantul, deci escaladarea trebuie sa continue");
  assert.match(outcome.error ?? "", /poate scrie in continuare/);
  assert.deepEqual(setup.added, ["role-muted"], "rolul se atribuie oricum; verificarea e despre efect, nu despre incercare");
});

test("un rol Muted care chiar blocheaza scrisul e raportat ca aplicat (N-01)", async () => {
  const setup = guildWith({ writableChannels: [] });

  const outcome = await adaptRaidGuild(setup.guild, async () => null).applySanction("raider-1", "mute", 0, "raid");

  assert.equal(outcome.applied, true);
  assert.equal(outcome.error, null);
});

test("cand permisiunile efective nu pot fi citite, mute-ul ramane aplicat dar se logheaza (N-01)", async () => {
  const setup = guildWith({ unreadable: true });
  const logs: string[] = [];

  const outcome = await adaptRaidGuild(setup.guild, async () => null, (_level, _scope, message) => { logs.push(message); })
    .applySanction("raider-1", "mute", 0, "raid");

  assert.equal(outcome.applied, true, "o citire esuata nu e o dovada ca participantul poate scrie");
  assert.ok(logs.some(entry => entry.includes("fara verificarea permisiunilor efective")));
});

test("un membru fara permissionsIn nu blocheaza sanctiunea (N-01)", async () => {
  const setup = guildWith({ withoutPermissionsIn: true });

  const outcome = await adaptRaidGuild(setup.guild, async () => null).applySanction("raider-1", "mute", 0, "raid");

  assert.equal(outcome.applied, true);
});

test("verificarea e marginita, ca un server cu mii de canale sa nu blocheze interventia (N-01)", () => {
  const probes = Array.from({ length: MAX_VERIFIED_CHANNELS + 20 }, (_unused, index) => ({
    channelId: `c${index}`,
    canSendMessages: false
  }));

  const effect = assessMuteEffect(probes.slice(0, MAX_VERIFIED_CHANNELS));

  assert.equal(effect.kind, "silenced");
  assert.equal(effect.kind === "silenced" ? effect.verified : 0, MAX_VERIFIED_CHANNELS);
});

test("un singur canal ramas scriibil e de ajuns ca mute-ul sa fie considerat ineficient (N-01)", () => {
  const effect = assessMuteEffect([
    { channelId: "c1", canSendMessages: false },
    { channelId: "c2", canSendMessages: true },
    { channelId: "c3", canSendMessages: false }
  ]);

  assert.equal(effect.kind, "still-writable");
  assert.deepEqual(effect.kind === "still-writable" ? effect.channelIds : [], ["c2"]);
  assert.match(describeMuteEffect(effect), /c2/);
});

test("canalele necitibile nu mascheaza unul scriibil (N-01)", () => {
  const effect = assessMuteEffect([
    { channelId: "c1", canSendMessages: null },
    { channelId: "c2", canSendMessages: true }
  ]);

  assert.equal(effect.kind, "still-writable");
});
