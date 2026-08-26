import test from "node:test";
import assert from "node:assert/strict";

import { AUDIT_CLAIM_TTL_MS, createAuditEntryClaim } from "../../features/command-security/auditEntryClaim.js";
import { adaptProtectedResourceGuild } from "../../app/runtime/protectedResourceGuildAdapter.js";
import { moduleContext } from "../moduleContextStub.js";
import type { AdaptableGuild } from "../../app/runtime/protectedResourceGuildAdapter.js";

const NOW = Date.parse("2026-08-25T12:00:00.000Z");

function claimStore() {
  const docs = new Map<string, Record<string, unknown>>();
  return {
    docs,
    async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>) {
      const id = String(filter._id);
      if (docs.has(id)) return { matchedCount: 1, modifiedCount: 0 };
      if (!options?.upsert || !update.$setOnInsert) return { matchedCount: 0, modifiedCount: 0 };
      docs.set(id, update.$setOnInsert as Record<string, unknown>);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }
  };
}

function guildWith(entries: Array<{ id: string; executor: string; at: number }>, attempts: number[] = []) {
  return moduleContext<AdaptableGuild>({
    id: "g1",
    ownerId: "owner-1",
    fetchAuditLogs: async () => {
      attempts.push(attempts.length);
      return {
        entries: new Map(entries.map(entry => [entry.id, {
          id: entry.id,
          executor: { id: entry.executor },
          target: { id: "res-1" },
          createdTimestamp: entry.at
        }]))
      };
    }
  });
}

test("o intrare deja corelata nu mai poate fi atribuita a doua oara, nici dupa restart (F-23)", async () => {
  const store = claimStore();
  const claim = createAuditEntryClaim(store);
  const entries = [{ id: "a1", executor: "mod-1", at: NOW }];

  const first = adaptProtectedResourceGuild(guildWith(entries), () => NOW, new Set(), {
    claimAuditEntry: (guildId, entryId) => claim.claim(guildId, entryId, new Date(NOW)),
    wait: async () => undefined
  });
  assert.equal(await first.findAuditActor("res-1", [12]), "mod-1");

  const afterRestart = adaptProtectedResourceGuild(guildWith(entries), () => NOW, new Set(), {
    claimAuditEntry: (guildId, entryId) => claim.claim(guildId, entryId, new Date(NOW)),
    wait: async () => undefined
  });

  assert.equal(await afterRestart.findAuditActor("res-1", [12]), null,
    "setul in memorie se pierde la repornire, deci aceeasi intrare ar fi fost atribuita din nou");
});

test("dedupul persistent supravietuieste golirii setului din memorie (F-23)", async () => {
  const store = claimStore();
  const claim = createAuditEntryClaim(store);
  const entries = [{ id: "a1", executor: "mod-1", at: NOW }];
  const memory = new Set<string>();
  const deps = {
    claimAuditEntry: (guildId: string, entryId: string) => claim.claim(guildId, entryId, new Date(NOW)),
    wait: async () => undefined
  };

  const guild = adaptProtectedResourceGuild(guildWith(entries), () => NOW, memory, deps);
  await guild.findAuditActor("res-1", [12]);
  memory.clear();

  assert.equal(await guild.findAuditActor("res-1", [12]), null);
});

test("revendicarea are TTL cel putin cat fereastra de corelare (F-23)", async () => {
  const store = claimStore();
  await createAuditEntryClaim(store).claim("g1", "a1", new Date(NOW));

  const stored = store.docs.get("g1:a1");
  const expiresAt = stored?.expiresAt as Date;

  assert.equal(expiresAt.getTime() - NOW, AUDIT_CLAIM_TTL_MS);
  assert.ok(AUDIT_CLAIM_TTL_MS > 60_000, "fereastra de corelare e de un minut, deci revendicarea trebuie sa o depaseasca");
});

test("corelarea reincearca inainte sa declare autorul lipsa (F-23)", async () => {
  const attempts: number[] = [];
  let calls = 0;
  const guild = moduleContext<AdaptableGuild>({
    id: "g1",
    ownerId: "owner-1",
    fetchAuditLogs: async () => {
      attempts.push(calls);
      calls += 1;
      if (calls < 3) return { entries: new Map() };
      return {
        entries: new Map([["a1", {
          id: "a1", executor: { id: "intarziat" }, target: { id: "res-1" }, createdTimestamp: NOW
        }]])
      };
    }
  });

  const adapted = adaptProtectedResourceGuild(guild, () => NOW, new Set(), { wait: async () => undefined });

  assert.equal(await adapted.findAuditActor("res-1", [12]), "intarziat",
    "evenimentul de gateway poate sosi inaintea intrarii din Audit Log");
  assert.ok(attempts.length >= 3, "fara reincercari, o intrare intarziata ramane neatribuita");
});

test("dupa toate reincercarile fara rezultat, autorul ramane necunoscut (F-23)", async () => {
  const attempts: number[] = [];
  const adapted = adaptProtectedResourceGuild(guildWith([], attempts), () => NOW, new Set(), { wait: async () => undefined });

  assert.equal(await adapted.findAuditActor("res-1", [12]), null);
  assert.equal(attempts.length, 3, "se reincearca de trei ori, apoi se renunta");
});

test("ambiguitatea ramane refuzata conservator, chiar cu dedup persistent (F-23)", async () => {
  const store = claimStore();
  const claim = createAuditEntryClaim(store);
  const guild = guildWith([
    { id: "a1", executor: "mod-1", at: NOW },
    { id: "a2", executor: "mod-2", at: NOW - 500 }
  ]);

  const adapted = adaptProtectedResourceGuild(guild, () => NOW, new Set(), {
    claimAuditEntry: (guildId, entryId) => claim.claim(guildId, entryId, new Date(NOW)),
    wait: async () => undefined
  });

  assert.equal(await adapted.findAuditActor("res-1", [12]), null, "doi executanti in aceeasi fereastra raman ambigui");
  assert.equal(store.docs.size, 0, "o corelare refuzata nu are voie sa consume revendicarea");
});

test("cand revendicarea persistenta esueaza, corelarea nu se blocheaza (F-23)", async () => {
  const adapted = adaptProtectedResourceGuild(
    guildWith([{ id: "a1", executor: "mod-1", at: NOW }]),
    () => NOW,
    new Set(),
    { claimAuditEntry: async () => { throw new Error("Mongo indisponibil"); }, wait: async () => undefined }
  );

  assert.equal(await adapted.findAuditActor("res-1", [12]), "mod-1",
    "o baza de date indisponibila nu trebuie sa opreasca protectia; dedupul in memorie ramane plasa de siguranta");
});
