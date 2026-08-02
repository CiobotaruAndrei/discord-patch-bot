import test from "node:test";
import assert from "node:assert/strict";

import { createRaidIncidentRepository } from "../../features/command-security/antiRaidIncidentRepository.js";
import { protectionStopActions } from "../../features/command-security/protectionStopActions.js";
import { raidIncidentStore } from "./raidIncidentStore.js";

async function openDryRun(model: ReturnType<typeof raidIncidentStore>, guildId = "g1") {
  const repository = createRaidIncidentRepository(model);
  const incident = await repository.open({ guildId, triggerReason: "test", dryRun: true });
  assert.ok(incident, "simularea trebuie sa deschida un incident");
  return { repository, incident };
}

test("o simulare activa ocupa activeKey si blocheaza un incident real (F-28)", async () => {
  const model = raidIncidentStore();
  const { repository } = await openDryRun(model);

  const real = await repository.open({ guildId: "g1", triggerReason: "raid real", dryRun: false });

  assert.equal(real, null, "acesta e chiar riscul pe care il descrie auditul: simularea blocheaza incidentul real");
});

test("/stop anti-raid-dry-run inchide simularea si elibereaza activeKey (F-28)", async () => {
  const model = raidIncidentStore();
  const { repository } = await openDryRun(model);
  let disabled = false;

  const actions = protectionStopActions("anti-raid-dry-run", "g1", {
    raidIncidents: repository,
    disableProtection: async () => { disabled = true; }
  });

  assert.equal(actions.needsAtomicStop, true, "oprirea simularii nu mai poate fi doar o scriere de setare");
  const note = await actions.stopAtomically();

  assert.equal(disabled, true);
  assert.match(note ?? "", /Simulari inchise: 1/);
  assert.equal(await repository.active("g1"), null, "niciun incident de simulare nu mai ocupa activeKey");
});

test("dupa oprirea simularii, un incident real se poate deschide (F-28)", async () => {
  const model = raidIncidentStore();
  const { repository } = await openDryRun(model);

  await protectionStopActions("anti-raid-dry-run", "g1", {
    raidIncidents: repository,
    disableProtection: async () => undefined
  }).stopAtomically();

  const real = await repository.open({ guildId: "g1", triggerReason: "raid real", dryRun: false });

  assert.ok(real, "dupa inchiderea simularii, protectia reala isi poate deschide incidentul");
  assert.equal(real?.dryRun, false);
});

test("simularea inchisa ramane in istoric, deci apare in /security-log (F-28)", async () => {
  const model = raidIncidentStore();
  const { repository, incident } = await openDryRun(model);

  await protectionStopActions("anti-raid-dry-run", "g1", {
    raidIncidents: repository,
    disableProtection: async () => undefined
  }).stopAtomically();

  const history = await repository.history("g1");
  const closed = history.find(entry => entry._id === incident?._id);

  assert.equal(closed?.stage, "resolved");
  assert.equal(closed?.dryRun, true, "istoricul pastreaza faptul ca a fost o simulare, nu un raid real");
});

test("oprirea fara nicio simulare activa o spune, in loc sa pretinda ca a inchis ceva (F-28)", async () => {
  const repository = createRaidIncidentRepository(raidIncidentStore());

  const note = await protectionStopActions("anti-raid-dry-run", "g1", {
    raidIncidents: repository,
    disableProtection: async () => undefined
  }).stopAtomically();

  assert.match(note ?? "", /Nu exista nicio simulare activa/);
});

test("doua simulari inchise una dupa alta nu se ciocnesc pe indexul unic activeKey (review PR #953)", async () => {
  const model = raidIncidentStore();
  const repository = createRaidIncidentRepository(model);

  const first = await repository.open({ guildId: "g1", triggerReason: "test 1", dryRun: true });
  assert.ok(first);
  const closedFirst = await repository.resolveDryRuns("g1");
  assert.deepEqual(closedFirst, [first._id]);

  const second = await repository.open({ guildId: "g2", triggerReason: "test 2", dryRun: true });
  assert.ok(second, "dupa prima inchidere, alt server trebuie sa poata deschide o simulare");
  const closedSecond = await repository.resolveDryRuns("g2");

  assert.deepEqual(
    closedSecond,
    [second._id],
    "activeKey trebuie sters, nu setat pe null: un null explicit ramane in indexul unic sparse si a doua inchidere ar da E11000"
  );
});
