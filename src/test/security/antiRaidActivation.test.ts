import test from "node:test";
import assert from "node:assert/strict";

import { planThresholdUpdate, THRESHOLD_OPTION_NAMES, currentThresholds } from "../../features/command-security/antiRaidThresholdOptions.js";
import { renderThresholdOutcome } from "../../features/command-presentation/antiRaidThresholdMessages.js";
import { toggleProtection } from "../../features/command-security/toggleProtectionUseCase.js";
import { START_STOP_TOGGLE_FIELDS } from "../../features/command-security/securityCommandFields.js";
import { antiRaidReadiness } from "../../features/command-security/protectionReadiness.js";
import { renderToggleProtectionOutcome } from "../../features/command-presentation/securityCommandMessages.js";
import { isDurationOption, THRESHOLD_OPTION_FIELDS } from "../../features/command-security/antiRaidThresholdOptions.js";
import { readThresholdOptions, runAntiRaidThresholdsCommand } from "../../features/command-handlers/antiRaidThresholdsCommand.js";
import type { SecurityOptions } from "../../features/command-security/securityInteractionContracts.js";
import { moduleContext } from "../moduleContextStub.js";
import type { ToggleProtectionDeps, ToggleProtectionInput } from "../../features/command-security/toggleProtectionUseCase.js";
import type { SecurityInteraction } from "../../features/command-security/securityInteractionContracts.js";

function toggleDeps(overrides: Partial<ToggleProtectionDeps> = {}): ToggleProtectionDeps {
  return {
    readConfiguredChannel: () => "chan-1",
    readiness: { readinessGaps: () => [], degradedReport: () => null },
    readChannelPermissions: async () => ({ viewChannel: true, sendMessages: true, embedLinks: true }),
    countActiveApprovals: async () => 0,
    stopAtomically: async () => null,
    persistEnabled: async () => undefined,
    runBackfill: async () => ({ delivered: 0, sentUnconfirmed: 0, undetermined: 0 }),
    ...overrides
  };
}

function stopInput(overrides: Partial<ToggleProtectionInput> = {}): ToggleProtectionInput {
  return {
    command: "stop",
    subcommand: "anti-raid",
    hasToggleFields: true,
    needsReadinessCheck: false,
    needsAtomicStop: false,
    needsBackfill: false,
    ownerOnly: true,
    ...overrides
  };
}

test("anti-raid este o protectie cu start/stop, nu un modul pornit automat (F-24)", () => {
  const toggle = START_STOP_TOGGLE_FIELDS["anti-raid"];
  assert.ok(toggle, "/start anti-raid si /stop anti-raid nu exista");
  assert.equal(toggle.enabled, "antiRaidEnabled");
  assert.equal(toggle.channel, "antiRaidAlertChannelId");
});

test("/start anti-raid refuza activarea cand botul nu poate sanctiona sau bloca canale (F-24)", () => {
  const interaction = moduleContext<SecurityInteraction>({
    guild: { members: { me: { permissions: { has: () => false }, roles: { highest: { position: 0 } } } } }
  });

  const missing = antiRaidReadiness(interaction);

  for (const permission of ["View Audit Log", "Moderate Members", "Mute Members", "Ban Members", "Manage Channels", "Manage Roles"]) {
    assert.ok(missing.includes(permission), `${permission} lipseste din verificarea de pregatire`);
  }
  assert.ok(missing.some(entry => entry.includes("@everyone")), "pozitia ierarhica trebuie verificata");
});

test("/start anti-raid porneste cand botul are tot ce ii trebuie (F-24)", () => {
  const interaction = moduleContext<SecurityInteraction>({
    guild: { members: { me: { permissions: { has: () => true }, roles: { highest: { position: 7 } } } } }
  });

  assert.deepEqual(antiRaidReadiness(interaction), []);
});

test("/stop anti-raid este owner-only (F-25)", async () => {
  const persisted: boolean[] = [];

  const outcome = await toggleProtection(
    stopInput({ isOwner: false, confirmed: true }),
    toggleDeps({ persistEnabled: async enabled => { persisted.push(enabled); } })
  );

  assert.deepEqual(outcome, { kind: "owner-only", subcommand: "anti-raid" });
  assert.deepEqual(persisted, [], "un admin obisnuit nu poate dezactiva protectia");
  assert.match(renderToggleProtectionOutcome(outcome) ?? "", /doar proprietarul serverului/);
});

test("/stop anti-raid cere confirm:true (F-25)", async () => {
  const persisted: boolean[] = [];

  const outcome = await toggleProtection(
    stopInput({ isOwner: true, confirmed: false }),
    toggleDeps({ persistEnabled: async enabled => { persisted.push(enabled); } })
  );

  assert.deepEqual(outcome, { kind: "confirmation-required", subcommand: "anti-raid" });
  assert.deepEqual(persisted, [], "fara confirmare protectia ramane pornita");
  assert.match(renderToggleProtectionOutcome(outcome) ?? "", /confirm:true/);
});

test("ownerul cu confirmare opreste protectia (F-25)", async () => {
  const persisted: boolean[] = [];

  const outcome = await toggleProtection(
    stopInput({ isOwner: true, confirmed: true }),
    toggleDeps({ persistEnabled: async enabled => { persisted.push(enabled); } })
  );

  assert.equal(outcome.kind, "toggled");
  assert.deepEqual(persisted, [false]);
});

test("celelalte protectii nu capata din greseala poarta de owner", async () => {
  const outcome = await toggleProtection(
    stopInput({ subcommand: "threat-protection", ownerOnly: false, isOwner: false, confirmed: false }),
    toggleDeps()
  );

  assert.equal(outcome.kind, "toggled", "doar anti-raid e owner-only");
});

test("/set anti-raid-thresholds persista valorile valide si pastreaza restul (F-26)", () => {
  const plan = planThresholdUpdate({ identicalMessages: 5 }, { "mention-count": 9, "safety-period": "1h" });

  assert.deepEqual([...plan.applied].sort(), ["mention-count", "safety-period"]);
  assert.deepEqual(plan.rejected, []);
  assert.equal(plan.thresholds.mentionCount, 9);
  assert.equal(plan.thresholds.safetyPeriodMs, 3_600_000);
  assert.equal(plan.thresholds.identicalMessages, 5, "pragul salvat anterior si neatins ramane");
  assert.equal(plan.thresholds.inviteMessages, 3, "pragurile neatinse raman la valoarea implicita");
});

test("o valoare in afara limitelor e refuzata cu motiv, fara sa piarda valorile valide (F-26)", () => {
  const plan = planThresholdUpdate(null, { "mention-count": 9, "identical-messages": 500 });

  assert.deepEqual(plan.applied, ["mention-count"]);
  assert.equal(plan.rejected.length, 1);
  assert.equal(plan.rejected[0].key, "identical-messages");
  assert.match(plan.rejected[0].reason, /intre 2 si 50/);
  assert.equal(plan.thresholds.mentionCount, 9, "valoarea valida se pastreaza");

  const message = renderThresholdOutcome({ kind: "applied", applied: plan.applied, rejected: plan.rejected });
  assert.match(message, /mention-count/);
  assert.match(message, /identical-messages/);
});

test("o durata scrisa gresit e refuzata, nu interpretata gresit (F-26)", () => {
  const plan = planThresholdUpdate(null, { "safety-period": "curand" });

  assert.deepEqual(plan.applied, []);
  assert.equal(plan.rejected[0]?.key, "safety-period");
});

test("comanda fara nicio optiune spune explicit ca nu schimba nimic (F-26)", () => {
  const plan = planThresholdUpdate(null, {});

  assert.equal(plan.provided, 0);
  assert.match(renderThresholdOutcome({ kind: "nothing-provided" }), /nu ai dat niciun prag/);
});

test("fiecare optiune expusa de comanda ajunge la un prag real (F-26)", () => {
  const durationOptions = new Set(THRESHOLD_OPTION_NAMES.filter(name =>
    name.endsWith("window") || name === "safety-period" || name === "mute-duration" || name === "timeout-duration" || name === "max-lockdown"
  ));

  for (const optionName of THRESHOLD_OPTION_NAMES) {
    const value = durationOptions.has(optionName) ? "30s" : 5;
    const plan = planThresholdUpdate(null, { [optionName]: value });
    assert.equal(plan.provided, 1, `${optionName} nu e citita`);
    assert.ok(
      plan.applied.includes(optionName) || plan.rejected.some(rejection => rejection.key === optionName),
      `${optionName} nu ajunge nici aplicata, nici refuzata cu motiv`
    );
  }

  assert.equal(
    Object.keys(currentThresholds(null)).length,
    THRESHOLD_OPTION_NAMES.length,
    "fiecare prag din AntiRaidThresholds are exact o optiune expusa in comanda"
  );
});

test("fiecare optiune este citita cu tipul ei declarat, altfel duratele nu pot fi schimbate (review #943)", () => {
  const integerReads: string[] = [];
  const stringReads: string[] = [];
  const options = moduleContext<SecurityOptions>({
    getSubcommand: () => "anti-raid-thresholds",
    getInteger: (name: string) => { integerReads.push(name); return name === "mention-count" ? 9 : null; },
    getString: (name: string) => { stringReads.push(name); return name === "safety-period" ? "1h" : null; },
    getChannel: () => null
  });

  const provided = readThresholdOptions(options);

  assert.deepEqual(provided, { "mention-count": 9, "safety-period": "1h" });
  for (const name of stringReads) {
    assert.ok(isDurationOption(name), `${name} nu e o durata, dar a fost citita ca string`);
  }
  for (const name of integerReads) {
    assert.equal(isDurationOption(name), false, `${name} e o durata, dar a fost citita ca intreg; Discord.js arunca in acest caz`);
  }
});

test("clasificarea duratelor acopera exact campurile in milisecunde", () => {
  for (const [optionName, field] of Object.entries(THRESHOLD_OPTION_FIELDS)) {
    assert.equal(isDurationOption(optionName), String(field).endsWith("Ms"), `${optionName} e clasificata gresit`);
  }
});

test("daca pragurile curente nu pot fi citite, nu se scrie nimic (review #943)", async () => {
  const persisted: unknown[] = [];
  const options = moduleContext<SecurityOptions>({
    getSubcommand: () => "anti-raid-thresholds",
    getInteger: (name: string) => (name === "mention-count" ? 9 : null),
    getString: () => null,
    getChannel: () => null
  });

  const message = await runAntiRaidThresholdsCommand(options, {
    readStored: () => ({ ok: false }),
    persist: async thresholds => { persisted.push(thresholds); },
    formatError: () => "eroare"
  });

  assert.deepEqual(persisted, [], "o citire esuata ar fi rescris toate pragurile personalizate cu valorile implicite");
  assert.match(message, /nu au putut fi citite/);
});
