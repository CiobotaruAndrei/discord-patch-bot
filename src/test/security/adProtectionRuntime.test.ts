import test from "node:test";
import { createHash } from "crypto";
import assert from "node:assert/strict";

import { createAdProtectionRuntime } from "../../features/command-security/adProtectionRuntime.js";
import { createAdProtectionRepository } from "../../features/command-security/adProtectionRepository.js";
import { adFingerprint } from "../../features/command-security/adRequestTypes.js";
import { adStore } from "./adStore.js";
import { protectionStopActions } from "../../features/command-security/protectionStopActions.js";
import { moduleContext } from "../moduleContextStub.js";

import type { AdMessage } from "../../features/command-security/adProtectionRuntime.js";

const T0 = Date.parse("2026-08-01T12:00:00.000Z");

const SAME_FILE_BYTES = new TextEncoder().encode("continut-identic");
const SAME_FILE_HASH = createHash("sha256").update(SAME_FILE_BYTES).digest("hex");

function harness(options: {
  enabled?: boolean;
  raid?: boolean;
  ownerId?: string;
  deleteFails?: boolean;
  warnFails?: boolean;
  autoBan?: "applied" | "failed" | "not-reached";
  attachmentBytes?: (url: string, timeoutMs: number) => Promise<Uint8Array | null>;
} = {}) {
  const requests = adStore();
  const attempts = adStore();
  const deleted: string[] = [];
  const published: string[] = [];
  const warns: Array<{ userId: string; reason: string }> = [];

  const runtime = createAdProtectionRuntime({
    fetchAttachmentBytes: options.attachmentBytes ?? (async () => SAME_FILE_BYTES),
    AdRequestModel: requests,
    AdAttemptModel: attempts,
    readGuildSettings: async () => ({ adProtectionEnabled: options.enabled !== false, adAlertChannelId: "c-ads" }),
    readOwnerId: () => options.ownerId ?? "owner-1",
    isRaidConfirmed: async () => options.raid === true,
    issueWarn: async (_guildId, userId, _username, reason) => {
      if (options.warnFails) return null;
      warns.push({ userId, reason });
      return { count: warns.length, limit: 3, autoBan: options.autoBan ?? ("not-reached" as const) };
    },
    publish: async (_guildId, body) => { published.push(body); return undefined; },
    now: () => T0
  });

  return { runtime, requests, attempts, deleted, published, warns, repo: createAdProtectionRepository(requests, attempts) };
}

function message(setup: ReturnType<typeof harness>, overrides: Partial<AdMessage> = {}, deleteFails = false): AdMessage {
  return {
    guildId: "g1",
    authorId: "u1",
    authorTag: "user#0001",
    bot: false,
    channelId: "c1",
    content: "Intra pe serverul meu discord.gg/abcd",
    attachmentUrl: null,
    attachmentName: null,
    attachmentSize: null,
    attachmentCount: 0,
    deleteMessage: async () => {
      if (deleteFails) throw new Error("Missing Permissions");
      setup.deleted.push(overrides.content ?? "reclama");
      return undefined;
    },
    ...overrides
  };
}

test("cu protectia oprita nu se sterge nimic", async () => {
  const setup = harness({ enabled: false });
  const outcome = await setup.runtime.handleMessage(message(setup));

  assert.deepEqual(outcome, { kind: "protection-off" });
  assert.deepEqual(setup.deleted, []);
});

test("in timpul unui raid confirmat, protectia reclamelor nu se suprapune peste anti-raid", async () => {
  const setup = harness({ raid: true });
  const outcome = await setup.runtime.handleMessage(message(setup));

  assert.deepEqual(outcome, { kind: "raid-active" });
  assert.deepEqual(setup.deleted, []);
  assert.deepEqual(setup.published, []);
});

test("un mesaj obisnuit nu e atins", async () => {
  const setup = harness();
  const outcome = await setup.runtime.handleMessage(message(setup, { content: "salut, ce faceti azi?" }));

  assert.deepEqual(outcome, { kind: "not-an-ad" });
  assert.deepEqual(setup.deleted, []);
});

test("ownerul poate publica reclame direct, fara sa creasca contorul", async () => {
  const setup = harness();
  const outcome = await setup.runtime.handleMessage(message(setup, { authorId: "owner-1" }));

  assert.deepEqual(outcome, { kind: "allowed-owner" });
  assert.deepEqual(setup.deleted, []);
  assert.equal(await setup.repo.readAttempts("g1", "owner-1"), null, "ownerul nu intra in contor");
});

test("o reclama aprobata trece si nu creste contorul", async () => {
  const setup = harness();
  const content = "Intra pe serverul meu discord.gg/abcd";
  const fingerprint = adFingerprint(content, null);
  await setup.repo.createRequest({
    requestId: "ad-1", guildId: "g1", requesterId: "u1", adText: content,
    fingerprint, link: null, invite: "discord.gg/abcd", attachmentUrl: null, target: null
  }, new Date(T0));
  await setup.repo.resolveRequest("g1", "ad-1", "approved", "owner-1", new Date(T0));

  const outcome = await setup.runtime.handleMessage(message(setup, { content }));

  assert.equal(outcome.kind, "allowed-approval");
  assert.deepEqual(setup.deleted, []);
  assert.equal(await setup.repo.readAttempts("g1", "u1"), null, "reclamele aprobate nu cresc contorul");
  assert.equal(setup.requests.records[0].status, "used");
});

test("o reclama diferita de cea aprobata e stearsa", async () => {
  const setup = harness();
  await setup.repo.createRequest({
    requestId: "ad-1", guildId: "g1", requesterId: "u1", adText: "reclama aprobata",
    fingerprint: adFingerprint("reclama aprobata", null), link: null, invite: null, attachmentUrl: null, target: null
  }, new Date(T0));
  await setup.repo.resolveRequest("g1", "ad-1", "approved", "owner-1", new Date(T0));

  const outcome = await setup.runtime.handleMessage(message(setup, { content: "Intra pe serverul meu discord.gg/altul" }));

  assert.equal(outcome.kind, "deleted");
  assert.equal(setup.deleted.length, 1);
  assert.equal(setup.requests.records[0].status, "approved", "aprobarea pentru alta reclama ramane neatinsa");
});

test("prima tentativa sterge mesajul si anunta 1/3", async () => {
  const setup = harness();
  const outcome = await setup.runtime.handleMessage(message(setup));

  assert.equal(outcome.kind, "deleted");
  assert.equal(outcome.kind === "deleted" && outcome.outcome.kind, "first");
  assert.equal(setup.deleted.length, 1);
  assert.match(setup.published[0], /1\/3/);
  assert.match(setup.published[0], /invitatie/);
  assert.deepEqual(setup.warns, []);
});

test("a doua tentativa avertizeaza ca urmatoarea produce warn", async () => {
  const setup = harness();
  await setup.runtime.handleMessage(message(setup));
  await setup.runtime.handleMessage(message(setup));

  assert.match(setup.published[1], /2\/3/);
  assert.match(setup.published[1], /Urmatoarea tentativa produce un warn/);
  assert.deepEqual(setup.warns, []);
});

test("a treia tentativa emite warn in sistemul existent si reseteaza contorul", async () => {
  const setup = harness();
  for (let index = 0; index < 3; index += 1) await setup.runtime.handleMessage(message(setup));

  assert.deepEqual(setup.warns, [{ userId: "u1", reason: "Reclame neautorizate: 3 tentative" }]);
  assert.match(setup.published[2], /3\/3/);
  const stored = await setup.repo.readAttempts("g1", "u1");
  assert.equal(stored?.strikes, 0);
  assert.equal(stored?.totalWarns, 1);
  assert.equal(stored?.totalDeleted, 3);
});

test("cand stergerea esueaza, incidentul o spune in loc sa pretinda ca mesajul a disparut (F-40)", async () => {
  const setup = harness();
  const outcome = await setup.runtime.handleMessage(message(setup, {}, true));

  assert.equal(outcome.kind === "deleted" && outcome.deleteFailed, true);
  assert.match(setup.published[0], /NU a putut fi stearsa/);
  assert.doesNotMatch(
    setup.published[0],
    /^.*Reclama a fost stearsa\./,
    "mesajul nu are voie sa afirme intai ca s-a sters si apoi ca nu s-a putut sterge"
  );
  const stored = await setup.repo.readAttempts("g1", "u1");
  assert.equal(stored?.strikes, 1, "tentativa se numara chiar daca stergerea a esuat");
  assert.equal(stored?.totalDeleted, 0, "istoricul nu are voie sa numere ca stearsa o reclama ramasa vizibila");
  assert.equal(stored?.totalDetected, 1, "tentativa detectata se numara separat de stergerea reusita");
  assert.equal(stored?.history[0]?.deleted, false);
});

test("cand stergerea reuseste, si detectia si stergerea se numara (F-40)", async () => {
  const setup = harness();
  await setup.runtime.handleMessage(message(setup, {}));

  const stored = await setup.repo.readAttempts("g1", "u1");
  assert.equal(stored?.totalDeleted, 1);
  assert.equal(stored?.totalDetected, 1);
  assert.equal(stored?.history[0]?.deleted, true);
});

test("cand warn-ul automat esueaza, mesajul cere verificare manuala", async () => {
  const setup = harness({ warnFails: true });
  for (let index = 0; index < 3; index += 1) await setup.runtime.handleMessage(message(setup));

  assert.equal(setup.warns.length, 0);
  assert.match(setup.published[2], /Warn-ul automat NU a putut fi emis/);
});

test("contoarele a doi utilizatori avanseaza separat", async () => {
  const setup = harness();
  await setup.runtime.handleMessage(message(setup, { authorId: "u1" }));
  await setup.runtime.handleMessage(message(setup, { authorId: "u2" }));
  await setup.runtime.handleMessage(message(setup, { authorId: "u1" }));

  assert.equal((await setup.repo.readAttempts("g1", "u1"))?.strikes, 2);
  assert.equal((await setup.repo.readAttempts("g1", "u2"))?.strikes, 1);
});

test("oprirea protectiei anuleaza cererile active", async () => {
  const setup = harness();
  await setup.repo.createRequest({
    requestId: "ad-1", guildId: "g1", requesterId: "u1", adText: "reclama",
    fingerprint: adFingerprint("reclama", null), link: null, invite: null, attachmentUrl: null, target: null
  }, new Date(T0));

  await setup.runtime.stopProtection("g1");

  assert.equal(setup.requests.records[0].status, "cancelled");
});

test("oprirea alege actiunea corecta pentru fiecare protectie", async () => {
  const cancelled: string[] = [];
  const disabled: string[] = [];
  const deps = {
    adRequests: {
      listRequests: async () => [{ status: "pending" }, { status: "used" }],
      cancelActiveRequests: async (guildId: string) => { cancelled.push(guildId); }
    },
    guardRequests: {
      countActive: async () => 4,
      cancelTypes: async (guildId: string) => { cancelled.push(`guard:${guildId}`); }
    },
    disableProtection: async () => { disabled.push("g1"); }
  };

  const ads = protectionStopActions("ad-protection", "g1", moduleContext<Parameters<typeof protectionStopActions>[2]>(deps));
  assert.equal(ads.needsAtomicStop, true);
  assert.equal(await ads.countActiveApprovals(), 1, "doar cererile active se numara, nu si istoricul");
  await ads.stopAtomically();
  assert.deepEqual(cancelled, ["g1"]);
  assert.deepEqual(disabled, ["g1"], "protectia se stinge dupa anularea cererilor, nu inainte");

  const guard = protectionStopActions("moderation-guard", "g1", moduleContext<Parameters<typeof protectionStopActions>[2]>(deps));
  assert.equal(await guard.countActiveApprovals(), 4);

  const other = protectionStopActions("threat-protection", "g1", moduleContext<Parameters<typeof protectionStopActions>[2]>(deps));
  assert.equal(other.needsAtomicStop, false, "protectiile fara aprobari nu trec pe calea de oprire atomica");
});

test("o reclama aprobata cu atasament trece si dupa repostare, cand fisierul e acelasi", async () => {
  const setup = harness();
  const content = "Intra pe serverul meu";
  await setup.repo.createRequest({
    requestId: "ad-1", guildId: "g1", requesterId: "u1", adText: content,
    fingerprint: adFingerprint(content, { name: "promo.png", size: 2048, hash: SAME_FILE_HASH }),
    link: null, invite: null, attachmentUrl: "https://cdn/ephemeral/promo.png", target: null
  }, new Date(T0));
  await setup.repo.resolveRequest("g1", "ad-1", "approved", "owner-1", new Date(T0));

  const outcome = await setup.runtime.handleMessage(message(setup, {
    content,
    attachmentUrl: "https://cdn/attachments/ALT/promo.png",
    attachmentName: "promo.png",
    attachmentSize: 2048,
    attachmentCount: 1
  }));

  assert.equal(outcome.kind, "allowed-approval", "URL-ul CDN difera intre incarcare si repostare; cu el in amprenta, aprobarea nu s-ar fi potrivit niciodata");
  assert.deepEqual(setup.deleted, []);
});

test("banul automat la limita de warn-uri e raportat in incident", async () => {
  const banned = harness({ autoBan: "applied" });
  for (let index = 0; index < 3; index += 1) await banned.runtime.handleMessage(message(banned));
  assert.match(banned.published[2], /ban automat aplicat/);

  const failed = harness({ autoBan: "failed" });
  for (let index = 0; index < 3; index += 1) await failed.runtime.handleMessage(message(failed));
  assert.match(failed.published[2], /banul automat NU a putut fi aplicat/);
});

test("un fisier DIFERIT cu acelasi nume si aceeasi dimensiune NU reutilizeaza aprobarea (F-39)", async () => {
  const otherBytes = new TextEncoder().encode("alt-continut-la-fel-de-lung");
  const setup = harness({ attachmentBytes: async () => otherBytes });
  const content = "Intra pe serverul meu";

  await setup.repo.createRequest({
    requestId: "ad-1", guildId: "g1", requesterId: "u1", adText: content,
    fingerprint: adFingerprint(content, { name: "promo.png", size: 2048, hash: SAME_FILE_HASH }),
    link: null, invite: null, attachmentUrl: "https://cdn/ephemeral/promo.png", target: null
  }, new Date(T0));
  await setup.repo.resolveRequest("g1", "ad-1", "approved", "owner-1", new Date(T0));

  const outcome = await setup.runtime.handleMessage(message(setup, {
    content,
    attachmentUrl: "https://cdn/attachments/ALT/promo.png",
    attachmentName: "promo.png",
    attachmentSize: 2048,
    attachmentCount: 1
  }));

  assert.notEqual(
    outcome.kind,
    "allowed-approval",
    "cu amprenta pe nume si dimensiune, orice fisier cu acelasi nume si aceeasi marime refolosea aprobarea"
  );
  assert.deepEqual(setup.deleted, [content], "reclama neaprobata se sterge");
});

test("cand atasamentul nu poate fi hashuit, aprobarea nu se potriveste (F-39)", async () => {
  const setup = harness({ attachmentBytes: async () => null });
  const content = "Intra pe serverul meu";

  await setup.repo.createRequest({
    requestId: "ad-1", guildId: "g1", requesterId: "u1", adText: content,
    fingerprint: adFingerprint(content, { name: "promo.png", size: 2048, hash: SAME_FILE_HASH }),
    link: null, invite: null, attachmentUrl: "https://cdn/ephemeral/promo.png", target: null
  }, new Date(T0));
  await setup.repo.resolveRequest("g1", "ad-1", "approved", "owner-1", new Date(T0));

  const outcome = await setup.runtime.handleMessage(message(setup, {
    content,
    attachmentUrl: "https://cdn/attachments/ALT/promo.png",
    attachmentName: "promo.png",
    attachmentSize: 2048,
    attachmentCount: 1
  }));

  assert.notEqual(outcome.kind, "allowed-approval", "un continut neverificat nu poate consuma o aprobare legata de continut");
});
