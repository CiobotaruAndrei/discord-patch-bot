import test from "node:test";
import assert from "node:assert/strict";
import { AuditLogEvent } from "discord.js";

import { adaptProtectedResourceGuild } from "../../app/runtime/protectedResourceGuildAdapter.js";
import { auditEventsFor } from "../../features/command-security/protectedResourceAuditEvents.js";
import { moduleContext } from "../moduleContextStub.js";

import type { AdaptableGuild } from "../../app/runtime/protectedResourceGuildAdapter.js";

const NOW = Date.parse("2026-08-23T12:00:00.000Z");

interface Entry {
  id: string;
  executorId: string;
  targetId: string;
  at: number;
}

function guildWith(byType: Readonly<Record<number, readonly Entry[]>>, asked: number[]) {
  return moduleContext<AdaptableGuild>({
    id: "g1",
    fetchAuditLogs: async (options?: Record<string, unknown>) => {
      const type = typeof options?.type === "number" ? options.type : -1;
      asked.push(type);
      const entries = byType[type] ?? [];
      return {
        entries: entries.map(entry => ({
          id: entry.id,
          executor: { id: entry.executorId },
          target: { id: entry.targetId },
          createdTimestamp: entry.at
        }))
      };
    }
  });
}

test("stergerea unei resurse se coreleaza cu evenimentul de stergere, nu cu orice intrare (F-23)", () => {
  assert.deepEqual(auditEventsFor("channel", ["delete"]), [AuditLogEvent.ChannelDelete]);
  assert.deepEqual(auditEventsFor("role", ["delete"]), [AuditLogEvent.RoleDelete]);
  assert.deepEqual(auditEventsFor("role", ["rename"]), [AuditLogEvent.RoleUpdate]);
  assert.ok(auditEventsFor("channel", ["permissions"]).includes(AuditLogEvent.ChannelOverwriteUpdate));
  assert.ok(
    auditEventsFor("channel", ["permissions"]).includes(AuditLogEvent.ChannelUpdate),
    "sincronizarea permisiunilor cu categoria e inregistrata de Discord ca ChannelUpdate; fara el, autorul ramane necunoscut si canalul nu se restaureaza (review PR #970)"
  );
});

test("se interogheaza exact tipurile de eveniment cerute (F-23)", async () => {
  const asked: number[] = [];
  const guild = guildWith({ [AuditLogEvent.ChannelDelete]: [{ id: "e1", executorId: "mod-1", targetId: "c1", at: NOW }] }, asked);

  const actor = await adaptProtectedResourceGuild(guild, () => NOW).findAuditActor("c1", [AuditLogEvent.ChannelDelete]);

  assert.equal(actor, "mod-1");
  assert.deepEqual(asked, [AuditLogEvent.ChannelDelete], "fara tip explicit, o alta operatiune recenta pe aceeasi resursa era atribuita gresit");
});

test("se alege intrarea cea mai apropiata de moment, nu cea mai recenta absoluta (F-23)", async () => {
  const asked: number[] = [];
  const guild = guildWith({
    [AuditLogEvent.ChannelUpdate]: [
      { id: "departe", executorId: "mod-departe", targetId: "c1", at: NOW - 50_000 },
      { id: "aproape", executorId: "mod-aproape", targetId: "c1", at: NOW - 500 }
    ]
  }, asked);

  const actor = await adaptProtectedResourceGuild(guild, () => NOW).findAuditActor("c1", [AuditLogEvent.ChannelUpdate]);

  assert.equal(actor, "mod-aproape");
});

test("aceeasi intrare nu e atribuita de doua ori la doua evenimente (F-23)", async () => {
  const asked: number[] = [];
  const guild = guildWith({ [AuditLogEvent.ChannelUpdate]: [{ id: "e1", executorId: "mod-1", targetId: "c1", at: NOW }] }, asked);
  const shared = new Set<string>();
  const adapted = adaptProtectedResourceGuild(guild, () => NOW, shared);

  assert.equal(await adapted.findAuditActor("c1", [AuditLogEvent.ChannelUpdate]), "mod-1");
  assert.equal(
    await adapted.findAuditActor("c1", [AuditLogEvent.ChannelUpdate]),
    null,
    "fara dedup, o singura intrare de audit ar acuza acelasi autor pentru doua modificari diferite"
  );
});

test("cand doua intrari apropiate au autori diferiti, corelarea refuza conservator (F-23)", async () => {
  const asked: number[] = [];
  const guild = guildWith({
    [AuditLogEvent.ChannelUpdate]: [
      { id: "a", executorId: "mod-1", targetId: "c1", at: NOW - 200 },
      { id: "b", executorId: "mod-2", targetId: "c1", at: NOW - 400 }
    ]
  }, asked);

  const actor = await adaptProtectedResourceGuild(guild, () => NOW).findAuditActor("c1", [AuditLogEvent.ChannelUpdate]);

  assert.equal(actor, null, "specificatia interzice sanctionarea cuiva ales dintr-o corelare ambigua");
});

test("intrarile din afara ferestrei nu sunt luate in seama (F-23)", async () => {
  const asked: number[] = [];
  const guild = guildWith({
    [AuditLogEvent.ChannelUpdate]: [{ id: "vechi", executorId: "mod-1", targetId: "c1", at: NOW - 5 * 60_000 }]
  }, asked);

  assert.equal(await adaptProtectedResourceGuild(guild, () => NOW).findAuditActor("c1", [AuditLogEvent.ChannelUpdate]), null);
});
