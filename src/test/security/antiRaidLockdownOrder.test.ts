import test from "node:test";
import assert from "node:assert/strict";

import { createRaidIntervention } from "../../features/command-security/antiRaidIntervention.js";
import { createRaidIncidentRepository } from "../../features/command-security/antiRaidIncidentRepository.js";
import { coordinatedRaid, COORDINATION_MINIMUM_PARTICIPANTS } from "../../features/command-security/antiRaidIncidentTypes.js";
import { raidIncidentStore } from "./raidIncidentStore.js";
import { moduleContext } from "../moduleContextStub.js";

import type { RaidGuildPort } from "../../features/command-security/antiRaidIntervention.js";
import { DEFAULT_ANTI_RAID_THRESHOLDS } from "../../features/command-security/antiRaidThresholds.js";

import type { AntiRaidThresholds } from "../../features/command-security/antiRaidThresholds.js";
import type { RaidParticipant } from "../../features/command-security/antiRaidIncidentTypes.js";

const THRESHOLDS: AntiRaidThresholds = DEFAULT_ANTI_RAID_THRESHOLDS;

function guildPort(trace: string[]): RaidGuildPort {
  return moduleContext<RaidGuildPort>({
    id: "g1",
    lockChannel: async (channelId: string) => {
      trace.push(`lock:${channelId}`);
      return { locked: true, previousSendMessages: null };
    },
    unlockChannel: async () => true,
    applySanction: async (userId: string, step: string) => {
      trace.push(`${step}:${userId}`);
      return { applied: true, error: null };
    },
    stripElevatedRoles: async () => ({ removed: [], blocked: [] }),
    purgeMessages: async () => ({ deleted: 0, unreachable: 0 }),
    publish: async () => undefined,
    alertOwner: async () => undefined
  });
}

async function incidentWith(participants: readonly string[]) {
  const model = raidIncidentStore();
  const repository = createRaidIncidentRepository(model);
  const incident = await repository.open({ guildId: "g1", triggerReason: "spam", dryRun: false });
  assert.ok(incident);
  for (const userId of participants) {
    await repository.addParticipant(incident._id, userId, false);
  }
  await repository.advance(incident._id, "suspected", "confirmed");
  return { model, repository, incidentId: incident._id };
}

function participant(userId: string): RaidParticipant {
  return {
    userId,
    bot: false,
    confirmedAt: new Date(0),
    state: "pending",
    appliedSteps: [],
    failedSteps: [],
    lastError: null
  };
}

test("regula de coordonare e explicita: doi participanti inseamna raid coordonat (F-34)", () => {
  assert.equal(COORDINATION_MINIMUM_PARTICIPANTS, 2);
  assert.equal(coordinatedRaid({ participants: [participant("u1"), participant("u2")] }), true);
  assert.equal(coordinatedRaid({ participants: [participant("u1")] }), false);
});

test("la doi participanti lockdown-ul se aplica INAINTEA sanctiunilor (F-34)", async () => {
  const { model, incidentId } = await incidentWith(["u1", "u2"]);
  const trace: string[] = [];
  const engine = createRaidIntervention({
    RaidIncidentModel: model,
    thresholds: async () => THRESHOLDS
  });

  await engine.advanceIncident(guildPort(trace), ["c1"]);

  const firstLock = trace.findIndex(entry => entry.startsWith("lock:"));
  const firstSanction = trace.findIndex(entry => !entry.startsWith("lock:"));

  assert.ok(firstLock >= 0, "lockdown-ul trebuie sa se aplice");
  assert.ok(firstSanction >= 0, "sanctiunile trebuie sa se aplice");
  assert.ok(
    firstLock < firstSanction,
    `lockdown-ul trebuie sa fie prima actiune; in timpul retry-urilor de mute participantii pot posta. Ordine reala: ${trace.join(" -> ")}`
  );
  assert.ok(incidentId.length > 0);
});

test("lockdown-ul se aplica si cand exista un singur participant, doar ordinea difera (F-34)", async () => {
  const { model } = await incidentWith(["u1"]);
  const trace: string[] = [];
  const engine = createRaidIntervention({
    RaidIncidentModel: model,
    thresholds: async () => THRESHOLDS
  });

  await engine.advanceIncident(guildPort(trace), ["c1"]);

  assert.ok(trace.some(entry => entry === "lock:c1"), "un raid necoordonat nu ramane fara lockdown");
});

test("un esec de persistenta la lockdown nu mai opreste sanctiunile (review PR #954)", async () => {
  const model = raidIncidentStore();
  const repository = createRaidIncidentRepository(model);
  const incident = await repository.open({ guildId: "g1", triggerReason: "spam", dryRun: false });
  assert.ok(incident);
  await repository.addParticipant(incident._id, "u1", false);
  await repository.addParticipant(incident._id, "u2", false);
  await repository.advance(incident._id, "suspected", "confirmed");

  const failing = {
    ...model,
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>) => {
      const push = update.$push as Record<string, unknown> | undefined;
      if (push && "lockedChannels" in push) throw new Error("Mongo indisponibil");
      return model.updateOne(filter, update, options);
    }
  };

  const trace: string[] = [];
  const alerts: string[] = [];
  const port = guildPort(trace);
  const engine = createRaidIntervention({
    RaidIncidentModel: failing,
    thresholds: async () => THRESHOLDS
  });

  await engine.advanceIncident(
    moduleContext<RaidGuildPort>({ ...port, alertOwner: async (body: string) => { alerts.push(body); } }),
    ["c1"]
  );

  assert.ok(trace.includes("lock:c1"), "canalul se blocheaza pe Discord chiar daca notarea in incident esueaza");
  assert.ok(
    trace.some(entry => entry.startsWith("mute:")),
    `o eroare tranzitorie de persistenta la lockdown nu are voie sa lase participantii nesanctionati. Urma: ${trace.join(" -> ")}`
  );
  assert.ok(
    alerts.some(body => body.includes("NU a putut fi salvata")),
    "ownerul trebuie sa afle ca deblocarea automata nu va acoperi acele canale"
  );
});
