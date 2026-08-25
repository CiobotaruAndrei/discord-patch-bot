import test from "node:test";
import assert from "node:assert/strict";

import { PermissionFlagsBits } from "discord.js";

import { assessMuteEffect, describeMuteEffect, resolveWriteProbe } from "../../features/command-security/muteEffectiveness.js";
import { adaptRaidGuild } from "../../app/runtime/antiRaidGuildAdapter.js";
import { moduleContext } from "../moduleContextStub.js";
import type { AdaptableRaidGuild } from "../../app/runtime/antiRaidGuildAdapter.js";

function guildWith(options: {
  writableChannels?: readonly string[];
  channels?: readonly string[];
  unreadable?: boolean;
  withoutPermissionsIn?: boolean;
  hiddenChannels?: readonly string[];
  threads?: readonly string[];
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
        const hidden = (options.hiddenChannels ?? []).includes(id);
        return {
          has: (flag: bigint) => {
            if (flag === PermissionFlagsBits.ViewChannel) return !hidden;
            if (flag === PermissionFlagsBits.SendMessages || flag === PermissionFlagsBits.SendMessagesInThreads) {
              return writable.has(id);
            }
            return false;
          }
        };
      }
  };

  const guild = moduleContext<AdaptableRaidGuild>({
    id: "g1",
    roles: {
      everyone: { id: "everyone" },
      cache: { values: () => [{ id: "role-muted", name: "Muted", position: options.rolePosition ?? 2 }] }
    },
    channels: {
      cache: {
        values: () => channelIds.map(id => ({
          id,
          isTextBased: () => true,
          isThread: () => (options.threads ?? []).includes(id)
        }))
      }
    },
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

test("toate canalele sunt inspectate, nu doar primele (review PR #992)", () => {
  const probes = Array.from({ length: 200 }, (_unused, index) => ({
    channelId: `c${index}`,
    canSendMessages: index !== 150 ? false : true
  }));

  const effect = assessMuteEffect(probes);

  assert.equal(effect.kind, "still-writable",
    "cu o limita de inspectie, ordinea arbitrara a cache-ului decidea daca mute-ul pare eficient");
  assert.deepEqual(effect.kind === "still-writable" ? effect.channelIds : [], ["c150"]);
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

test("un canal invizibil nu produce escaladare inutila (review PR #992)", async () => {
  const setup = guildWith({ writableChannels: ["c2"], hiddenChannels: ["c2"] });

  const outcome = await adaptRaidGuild(setup.guild, async () => null).applySanction("raider-1", "mute", 0, "raid");

  assert.equal(outcome.applied, true,
    "bitul SendMessages poate ramane pe un canal fara ViewChannel; participantul tot nu poate posta acolo");
});

test("un thread scriibil prin SendMessagesInThreads e prins (review PR #992)", async () => {
  const setup = guildWith({ channels: ["c1", "thread-1"], writableChannels: ["thread-1"], threads: ["thread-1"] });

  const outcome = await adaptRaidGuild(setup.guild, async () => null).applySanction("raider-1", "mute", 0, "raid");

  assert.equal(outcome.applied, false, "un thread ramane scriibil prin permisiunea lui proprie, nu prin SendMessages");
  assert.match(outcome.error ?? "", /thread-1/);
});

test("scrierea cere si vizibilitate, si permisiunea potrivita tipului (review PR #992)", () => {
  assert.equal(resolveWriteProbe({ channelId: "c1", isThread: false, canView: true, canPost: true }).canSendMessages, true);
  assert.equal(resolveWriteProbe({ channelId: "c1", isThread: false, canView: false, canPost: true }).canSendMessages, false);
  assert.equal(resolveWriteProbe({ channelId: "c1", isThread: false, canView: true, canPost: false }).canSendMessages, false);
  assert.equal(resolveWriteProbe({ channelId: "c1", isThread: false, canView: null, canPost: true }).canSendMessages, null);
});

test("canalele necitibile opresc concluzia de tacere, nu o confirma (review PR #992)", () => {
  const effect = assessMuteEffect([
    { channelId: "c1", canSendMessages: false },
    { channelId: "c2", canSendMessages: null }
  ]);

  assert.equal(effect.kind, "unverifiable",
    "cu un canal necitit, `silenced` ar fi o afirmatie pe care datele nu o sustin");
});
