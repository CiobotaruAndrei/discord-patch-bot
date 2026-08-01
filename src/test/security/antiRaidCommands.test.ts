import test from "node:test";
import assert from "node:assert/strict";

import attachAntiRaidHandler from "../../features/command-handlers/antiRaidInteractionHandler.js";
import { createRaidIncidentRepository } from "../../features/command-security/antiRaidIncidentRepository.js";
import { statusLines, participantLines } from "../../features/command-presentation/antiRaidMessages.js";
import { DEFAULT_ANTI_RAID_THRESHOLDS } from "../../features/command-security/antiRaidThresholds.js";
import { raidIncidentStore } from "./raidIncidentStore.js";
import { moduleContext } from "../moduleContextStub.js";

import type { RaidIncidentRecord } from "../../features/command-security/antiRaidIncidentTypes.js";

const T0 = Date.parse("2026-08-01T12:00:00.000Z");

function interaction(subcommand: string, overrides: Record<string, unknown> = {}) {
  const replies: Record<string, unknown>[] = [];
  const strings = (overrides.strings ?? {}) as Record<string, string>;
  return {
    replies,
    guild: { id: "g1", ownerId: "owner-1" },
    user: { id: "owner-1" },
    isChatInputCommand: () => true,
    commandName: "anti-raid",
    reply: async (payload: Record<string, unknown>) => { replies.push(payload); return undefined; },
    followUp: async (payload: Record<string, unknown>) => { replies.push(payload); return undefined; },
    options: {
      getSubcommand: () => subcommand,
      getString: (name: string) => strings[name] ?? null,
      getBoolean: (name: string) => (overrides.booleans as Record<string, boolean> | undefined)?.[name] ?? null,
      getUser: () => (overrides.target as { id: string; bot?: boolean } | undefined) ?? null
    },
    ...overrides
  };
}

function handlerFor(model: ReturnType<typeof raidIncidentStore>) {
  return attachAntiRaidHandler.buildCommandHandler(moduleContext<Parameters<typeof attachAntiRaidHandler.buildCommandHandler>[0]>({
    RaidIncidentModel: model,
    getGuildSettings: async () => ({ antiRaidThresholds: null })
  }));
}

async function run(model: ReturnType<typeof raidIncidentStore>, subcommand: string, overrides: Record<string, unknown> = {}) {
  const handler = handlerFor(model);
  const call = interaction(subcommand, overrides);
  await handler.handle(moduleContext<Parameters<typeof handler.handle>[0]>(call), moduleContext<Parameters<typeof handler.handle>[1]>({}));
  return call;
}

test("subcomenzile owner-only sunt refuzate unui admin obisnuit", async () => {
  const model = raidIncidentStore();
  for (const subcommand of ["force-start", "force-stop", "participant-add", "participant-remove"]) {
    const call = await run(model, subcommand, { user: { id: "admin-1" } });
    assert.match(String(call.replies[0]?.content), /Doar proprietarul/, `${subcommand} trebuie sa fie owner-only`);
  }
});

test("status arata ca nu exista incident, fara sa arunce", async () => {
  const call = await run(raidIncidentStore(), "status");
  assert.match(String(call.replies[0]?.content), /Nu exista niciun incident/);
});

test("force-start confirma manual un raid si il marcheaza ca pornit manual", async () => {
  const model = raidIncidentStore();
  const call = await run(model, "force-start");

  assert.match(String(call.replies[0]?.content), /Raid confirmat manual/);
  const incident = await createRaidIncidentRepository(model).active("g1");
  assert.equal(incident?.stage, "confirmed");
  assert.equal(incident?.manual, true);
  assert.ok(incident?.confirmedAt, "un raid confirmat manual isi noteaza momentul, ca lockdown-ul sa poata fi masurat");
});

test("force-start nu deschide un al doilea incident peste unul activ", async () => {
  const model = raidIncidentStore();
  await run(model, "force-start");
  const call = await run(model, "force-start");

  assert.match(String(call.replies[0]?.content), /Exista deja un incident activ/);
  assert.equal((await createRaidIncidentRepository(model).history("g1")).length, 1);
});

test("force-stop cere confirm:true explicit", async () => {
  const model = raidIncidentStore();
  await run(model, "force-start");
  const call = await run(model, "force-stop", { booleans: { confirm: false } });

  assert.match(String(call.replies[0]?.content), /confirm:true/);
  assert.equal((await createRaidIncidentRepository(model).active("g1"))?.stage, "confirmed");
});

test("force-stop se poate folosi numai dupa un raid confirmat", async () => {
  const model = raidIncidentStore();
  await createRaidIncidentRepository(model).open({ guildId: "g1", triggerReason: "suspiciune" }, new Date(T0));

  const call = await run(model, "force-stop", { booleans: { confirm: true } });

  assert.match(String(call.replies[0]?.content), /numai dupa un raid confirmat/);
  assert.equal((await createRaidIncidentRepository(model).active("g1"))?.stage, "suspected");
});

test("force-stop trece incidentul in restaurare si spune ca sanctiunile raman", async () => {
  const model = raidIncidentStore();
  await run(model, "force-start");

  const call = await run(model, "force-stop", { booleans: { confirm: true } });

  assert.match(String(call.replies[0]?.content), /sanctiunile aplicate raman/);
  assert.equal((await createRaidIncidentRepository(model).active("g1"))?.stage, "recovery");
});

test("participant-add introduce membrul in fluxul de sanctiuni", async () => {
  const model = raidIncidentStore();
  await run(model, "force-start");

  const call = await run(model, "participant-add", { target: { id: "u1" } });

  assert.match(String(call.replies[0]?.content), /Mute 24h -> Timeout 24h -> Ban/);
  const incident = await createRaidIncidentRepository(model).active("g1");
  assert.equal(incident?.participants[0].userId, "u1");
  assert.equal(incident?.participants[0].state, "pending");
});

test("ownerul nu poate fi adaugat ca participant la propriul incident", async () => {
  const model = raidIncidentStore();
  await run(model, "force-start");

  const call = await run(model, "participant-add", { target: { id: "owner-1" } });

  assert.match(String(call.replies[0]?.content), /Proprietarul serverului nu poate fi adaugat/);
  assert.equal((await createRaidIncidentRepository(model).active("g1"))?.participants.length, 0);
});

test("participant-remove scoate membrul, dar spune raspicat ca sanctiunile raman", async () => {
  const model = raidIncidentStore();
  const repository = createRaidIncidentRepository(model);
  await run(model, "force-start");
  const incident = await repository.active("g1");
  await repository.addParticipant(incident?._id ?? "", "u1", false, new Date(T0));
  await repository.recordSanction(incident?._id ?? "", "u1", "mute", true, null, new Date(T0));

  const call = await run(model, "participant-remove", { target: { id: "u1" } });

  assert.match(String(call.replies[0]?.content), /mute/);
  assert.match(String(call.replies[0]?.content), /NU au fost anulate automat/);
  assert.equal((await repository.active("g1"))?.participants.length, 0);
});

test("participant-list nu arata incidentul altui server", async () => {
  const model = raidIncidentStore();
  const repository = createRaidIncidentRepository(model);
  const other = await repository.open({ guildId: "g2", triggerReason: "spam" }, new Date(T0));
  await repository.addParticipant(other?._id ?? "", "strain", false, new Date(T0));

  const call = await run(model, "participant-list", { strings: { "incident-id": other?._id ?? "" } });

  assert.match(String(call.replies[0]?.content), /apartine altui server/);
});

test("statusul arata etapa, canalele blocate, participantii si erorile", () => {
  const incident: RaidIncidentRecord = {
    _id: "raid-1", guildId: "g1", stage: "containment",
    startedAt: new Date(T0 - 10 * 60_000), confirmedAt: new Date(T0 - 9 * 60_000), resolvedAt: null,
    lastActivityAt: new Date(T0 - 60_000), triggerReason: "mesaje identice", manual: false, dryRun: false,
    participants: [
      { userId: "u1", bot: false, confirmedAt: new Date(T0), state: "stopped", appliedSteps: ["mute"], failedSteps: [], lastError: null },
      { userId: "u2", bot: false, confirmedAt: new Date(T0), state: "pending", appliedSteps: [], failedSteps: ["mute"], lastError: "Missing Permissions" }
    ],
    lockedChannels: [
      { channelId: "c1", previousSendMessages: true, lockedAt: new Date(T0), restoredAt: null },
      { channelId: "c2", previousSendMessages: true, lockedAt: new Date(T0), restoredAt: new Date(T0) }
    ],
    pendingActions: ["restaurare canal c1"], errors: ["Lockdown esuat pentru canalul c3"], restoreProgress: 40
  };

  const lines = statusLines(incident, DEFAULT_ANTI_RAID_THRESHOLDS.safetyPeriodMs, T0).join("\n");

  assert.match(lines, /raid-1/);
  assert.match(lines, /izolare/);
  assert.match(lines, /<#c1>/);
  assert.doesNotMatch(lines, /<#c2>/, "un canal deja restaurat nu mai apare ca blocat");
  assert.match(lines, /opriti: 1, nesanctionabili: 0, ramasi: 1/);
  assert.match(lines, /Restaurare: 40%/);
  assert.match(lines, /Lockdown esuat pentru canalul c3/);
  assert.match(lines, /restaurare canal c1/);
});

test("lista participantilor arata sanctiunile aplicate, cele esuate si eroarea", () => {
  const incident: RaidIncidentRecord = {
    _id: "raid-2", guildId: "g1", stage: "containment",
    startedAt: new Date(T0), confirmedAt: new Date(T0), resolvedAt: null, lastActivityAt: new Date(T0),
    triggerReason: "spam", manual: false, dryRun: false,
    participants: [
      { userId: "bot-1", bot: true, confirmedAt: new Date(T0), state: "stopped", appliedSteps: ["ban"], failedSteps: [], lastError: null },
      { userId: "u2", bot: false, confirmedAt: new Date(T0), state: "failed", appliedSteps: [], failedSteps: ["mute", "timeout", "ban"], lastError: "ierarhie Discord" }
    ],
    lockedChannels: [], pendingActions: [], errors: [], restoreProgress: 0
  };

  const lines = participantLines(incident).join("\n");

  assert.match(lines, /participanti: 2, opriti: 1, nesanctionabili: 1/);
  assert.match(lines, /<@bot-1> \(bot, stopped\)/);
  assert.match(lines, /esuate: mute, timeout, ban/);
  assert.match(lines, /ierarhie Discord/);
});

test("force-start porneste interventia, nu doar salveaza incidentul", async () => {
  const model = raidIncidentStore();
  const triggered: string[] = [];
  const handler = attachAntiRaidHandler.buildCommandHandler(moduleContext<Parameters<typeof attachAntiRaidHandler.buildCommandHandler>[0]>({
    RaidIncidentModel: model,
    getGuildSettings: async () => ({ antiRaidThresholds: null }),
    runRaidIntervention: async (guildId: string) => { triggered.push(guildId); return undefined; }
  }));
  const call = interaction("force-start");

  await handler.handle(moduleContext<Parameters<typeof handler.handle>[0]>(call), moduleContext<Parameters<typeof handler.handle>[1]>({}));

  assert.deepEqual(triggered, ["g1"], "un incident confirmat manual care nu porneste interventia ramane inert");
  assert.match(String(call.replies[0]?.content), /interventia a pornit/);
});

test("force-stop porneste restaurarea, nu doar schimba etapa", async () => {
  const model = raidIncidentStore();
  const triggered: string[] = [];
  const handler = attachAntiRaidHandler.buildCommandHandler(moduleContext<Parameters<typeof attachAntiRaidHandler.buildCommandHandler>[0]>({
    RaidIncidentModel: model,
    getGuildSettings: async () => ({ antiRaidThresholds: null }),
    runRaidIntervention: async (guildId: string) => { triggered.push(guildId); return undefined; }
  }));
  await createRaidIncidentRepository(model).open({ guildId: "g1", triggerReason: "spam", stage: "containment" }, new Date(T0));
  const call = interaction("force-stop", { booleans: { confirm: true } });

  await handler.handle(moduleContext<Parameters<typeof handler.handle>[0]>(call), moduleContext<Parameters<typeof handler.handle>[1]>({}));

  assert.deepEqual(triggered, ["g1"]);
  assert.match(String(call.replies[0]?.content), /restaurarea controlata a pornit/i);
});

test("fara interventie disponibila, raspunsul spune adevarul in loc sa pretinda ca a pornit", async () => {
  const model = raidIncidentStore();
  const call = await run(model, "force-start");

  assert.match(String(call.replies[0]?.content), /nu este disponibila in acest proces/);
});

test("un participant adaugat dupa inceperea restaurarii e refuzat, nu acceptat degeaba", async () => {
  const model = raidIncidentStore();
  const repository = createRaidIncidentRepository(model);
  const incident = await repository.open({ guildId: "g1", triggerReason: "spam", stage: "containment" }, new Date(T0));
  await repository.advance(incident?._id ?? "", "containment", "recovery", new Date(T0));

  const call = await run(model, "participant-add", { target: { id: "u1" } });

  assert.match(String(call.replies[0]?.content), /deja in restaurare/);
  assert.equal((await repository.active("g1"))?.participants.length, 0,
    "un participant pending intr-un incident care se restaureaza nu ar fi fost niciodata sanctionat");
});
