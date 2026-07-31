import test from "node:test";
import assert from "node:assert/strict";

import {
  applyModerationCommand,
  type ModerationDeps,
  type ModerationInput,
  type ModerationOutcome,
  type ModerationTarget,
  type WarningChannel
} from "../../features/moderation/moderationSanctionUseCase.js";
import { moderationOutcomeMessage } from "../../features/moderation/moderationOutcomeMessages.js";

const NOW = 1_700_000_000_000;

type Recorder = { steps: string[] };

function target(recorder: Recorder, overrides: Partial<ModerationTarget> = {}): ModerationTarget {
  return {
    canAct: true,
    canTimeout: true,
    canKick: true,
    canBan: true,
    timeout: async duration => { recorder.steps.push(`timeout:${duration}`); },
    kick: async () => { recorder.steps.push("kick"); },
    ban: async () => { recorder.steps.push("ban"); },
    ...overrides
  };
}

function deps(recorder: Recorder, overrides: Partial<ModerationDeps> = {}): ModerationDeps {
  return {
    validateReason: raw => raw ?? null,
    discordReason: reason => reason ?? undefined,
    botHasPermission: () => true,
    resolveTarget: async () => { recorder.steps.push("resolve-target"); return target(recorder); },
    unbanUser: async () => { recorder.steps.push("unban"); },
    setWarnBanLimit: async () => 3,
    saveSanction: async () => { recorder.steps.push("save"); },
    findSanctionsForUser: async () => ({ timeout: null, mute: null }),
    removeSanction: async () => { recorder.steps.push("remove-sanction"); return true; },
    removeWarning: async () => ({ removed: true, remaining: 1 }),
    resolveWarningChannel: async () => ({ status: "ready", send: async () => { recorder.steps.push("warn-sent"); } }),
    addWarning: async () => { recorder.steps.push("warn-saved"); return { count: 1, limit: 0 }; },
    dropWarning: async () => { recorder.steps.push("warn-dropped"); return true; },
    newWarningId: () => "w1",
    reportOrphanedWarning: () => { recorder.steps.push("report-orphan"); },
    reportFailedAutoBan: () => { recorder.steps.push("report-autoban"); },
    now: () => NOW,
    ...overrides
  };
}

function input(overrides: Partial<ModerationInput> = {}): ModerationInput {
  return {
    command: "timeout",
    rawReason: "motiv",
    hasAttachment: false,
    duration: 60_000,
    limit: null,
    userId: "u1",
    username: "Ana",
    moderatorId: "m1",
    ...overrides
  };
}

test("timeout: daca persistenta cade, sanctiunea aplicata pe Discord e ridicata inainte de a arunca", async () => {
  const recorder: Recorder = { steps: [] };
  await assert.rejects(
    () => applyModerationCommand(input(), deps(recorder, { saveSanction: async () => { throw new Error("Mongo picat"); } })),
    /Mongo picat/
  );
  assert.deepEqual(
    recorder.steps,
    ["resolve-target", "timeout:60000", "timeout:null"],
    "fara compensare, utilizatorul ar ramane cu timeout pe Discord si fara inregistrare"
  );
});

test("remove-timeout: persistenta care nu confirma stergerea readuce sanctiunea cu timpul ramas", async () => {
  const recorder: Recorder = { steps: [] };
  const active = { userId: "u1", username: "Ana", moderatorId: "m1", appliedAt: new Date(NOW - 1000), expiresAt: new Date(NOW + 120_000), reason: "spam" };
  await assert.rejects(
    () => applyModerationCommand(
      input({ command: "remove-timeout" }),
      deps(recorder, {
        findSanctionsForUser: async () => ({ timeout: active, mute: null }),
        removeSanction: async () => false
      })
    ),
    /nu a putut fi eliminata/
  );
  assert.deepEqual(recorder.steps, ["resolve-target", "timeout:null", "timeout:120000"], "sanctiunea revine cu exact timpul ramas");
});

test("remove-timeout: starea cu timeout si mute simultan nu atinge Discord deloc", async () => {
  const recorder: Recorder = { steps: [] };
  const record = { userId: "u1", username: "Ana", moderatorId: "m1", appliedAt: new Date(NOW) };
  const outcome = await applyModerationCommand(
    input({ command: "unmute" }),
    deps(recorder, { findSanctionsForUser: async () => ({ timeout: record, mute: record }) })
  );
  assert.deepEqual(outcome, { kind: "conflicting-sanctions" });
  assert.deepEqual(recorder.steps, ["resolve-target"], "o stare ambigua nu se rezolva ghicind care sanctiune se ridica");
});

test("unban si warn-ban-limit nu cer prezenta membrului pe server", async () => {
  for (const [command, expected] of [["unban", "unban"], ["warn-ban-limit", null]] as const) {
    const recorder: Recorder = { steps: [] };
    await applyModerationCommand(input({ command, limit: 5 }), deps(recorder));
    assert.ok(!recorder.steps.includes("resolve-target"), `${command} nu are nevoie de membru`);
    if (expected) assert.ok(recorder.steps.includes(expected));
  }
});

test("warn: la atingerea limitei se aplica ban automat, iar esecul lui nu anuleaza avertismentul", async () => {
  const applied: Recorder = { steps: [] };
  const atLimit = await applyModerationCommand(
    input({ command: "warn" }),
    deps(applied, {
      addWarning: async () => ({ count: 3, limit: 3 }),
      resolveTarget: async () => target(applied)
    })
  );
  assert.deepEqual(atLimit, { kind: "warned", count: 3, autoBan: "applied" });
  assert.ok(applied.steps.includes("ban"));

  const failing: Recorder = { steps: [] };
  const banFailed = await applyModerationCommand(
    input({ command: "warn" }),
    deps(failing, {
      addWarning: async () => ({ count: 3, limit: 3 }),
      resolveTarget: async () => target(failing, { ban: async () => { throw new Error("Discord refuza"); } })
    })
  );
  assert.deepEqual(banFailed, { kind: "warned", count: 3, autoBan: "failed" });
  assert.ok(failing.steps.includes("report-autoban"), "esecul auto-ban-ului e raportat, nu inghitit");
});

test("warn: livrarea esuata sterge inregistrarea; daca nici stergerea nu reuseste, utilizatorul afla ca ramane orfana", async () => {
  const compensated: Recorder = { steps: [] };
  await assert.rejects(
    () => applyModerationCommand(
      input({ command: "warn" }),
      deps(compensated, {
        resolveWarningChannel: async (): Promise<WarningChannel> => ({ status: "ready", send: async () => { throw new Error("canal indisponibil"); } })
      })
    ),
    /canal indisponibil/
  );
  assert.deepEqual(compensated.steps.slice(-2), ["warn-saved", "warn-dropped"]);

  const orphaned: Recorder = { steps: [] };
  const outcome = await applyModerationCommand(
    input({ command: "warn" }),
    deps(orphaned, {
      resolveWarningChannel: async (): Promise<WarningChannel> => ({ status: "ready", send: async () => { throw new Error("canal indisponibil"); } }),
      dropWarning: async () => { throw new Error("Mongo picat"); }
    })
  );
  assert.deepEqual(outcome, { kind: "warn-orphaned" }, "esecul dublu nu se propaga ca eroare oarba: userul primeste instructiunea de curatare");
  assert.ok(orphaned.steps.includes("report-orphan"));
});

test("warn: fara motiv si fara atasament nu se scrie nimic", async () => {
  const recorder: Recorder = { steps: [] };
  const outcome = await applyModerationCommand(
    input({ command: "warn", rawReason: undefined, hasAttachment: false }),
    deps(recorder)
  );
  assert.deepEqual(outcome, { kind: "warn-needs-evidence" });
  assert.deepEqual(recorder.steps, ["resolve-target"]);
});

test("un canal de warn care nu trece verificarile nu ajunge sa scrie avertismentul", async () => {
  for (const [channel, expected] of [
    [{ status: "not-selected" }, "warn-channel-required"],
    [{ status: "missing-permissions", missing: ["Send Messages"] }, "warn-channel-missing-permissions"],
    [{ status: "without-id" }, "warn-channel-without-id"],
    [{ status: "unavailable" }, "warn-channel-unavailable"]
  ] as ReadonlyArray<readonly [WarningChannel, string]>) {
    const recorder: Recorder = { steps: [] };
    const outcome = await applyModerationCommand(
      input({ command: "warn" }),
      deps(recorder, { resolveWarningChannel: async () => channel })
    );
    assert.equal(outcome.kind, expected);
    assert.ok(!recorder.steps.includes("warn-saved"), `${expected}: nu se salveaza avertismentul`);
  }
});

test("ierarhia si permisiunile opresc actiunea inainte de orice efect", async () => {
  const blocked: Recorder = { steps: [] };
  const byHierarchy = await applyModerationCommand(
    input({ command: "kick" }),
    deps(blocked, { resolveTarget: async () => target(blocked, { canAct: false }) })
  );
  assert.deepEqual(byHierarchy, { kind: "target-unavailable" });
  assert.deepEqual(blocked.steps, []);

  const noPermission: Recorder = { steps: [] };
  const byPermission = await applyModerationCommand(
    input({ command: "ban" }),
    deps(noPermission, { botHasPermission: () => false })
  );
  assert.deepEqual(byPermission, { kind: "bot-missing-permission", permission: "BanMembers" });
  assert.deepEqual(noPermission.steps, ["resolve-target"]);
});

test("motivul invalid nu ajunge niciodata la Discord", async () => {
  const recorder: Recorder = { steps: [] };
  const outcome = await applyModerationCommand(
    input(),
    deps(recorder, { validateReason: () => { throw new Error("Motivul depaseste limita."); } })
  );
  assert.deepEqual(outcome, { kind: "invalid-reason", message: "Motivul depaseste limita." });
  assert.deepEqual(recorder.steps, []);
});

const OUTCOME_SAMPLES: { [K in ModerationOutcome["kind"]]: Extract<ModerationOutcome, { kind: K }> } = {
  "invalid-reason": { kind: "invalid-reason", message: "Motivul nu este valid." },
  "invalid-limit": { kind: "invalid-limit" },
  "limit-changed": { kind: "limit-changed", previous: 3, limit: 5 },
  "user-required": { kind: "user-required" },
  "unban-unavailable": { kind: "unban-unavailable" },
  unbanned: { kind: "unbanned" },
  "target-unavailable": { kind: "target-unavailable" },
  "invalid-duration": { kind: "invalid-duration" },
  "bot-missing-permission": { kind: "bot-missing-permission", permission: "ModerateMembers" },
  "discord-action-unavailable": { kind: "discord-action-unavailable", action: "kick" },
  sanctioned: { kind: "sanctioned", command: "timeout", expiresAt: new Date(NOW) },
  "conflicting-sanctions": { kind: "conflicting-sanctions" },
  "wrong-sanction-type": { kind: "wrong-sanction-type", has: "mute", asked: "timeout" },
  "no-active-sanction": { kind: "no-active-sanction", asked: "mute" },
  "sanction-removed": { kind: "sanction-removed" },
  "member-removed": { kind: "member-removed", command: "ban" },
  "warn-removed": { kind: "warn-removed", remaining: 2 },
  "no-warnings": { kind: "no-warnings" },
  "warn-needs-evidence": { kind: "warn-needs-evidence" },
  "warn-channel-required": { kind: "warn-channel-required" },
  "warn-channel-missing-permissions": { kind: "warn-channel-missing-permissions", missing: ["View Channel"] },
  "warn-channel-without-id": { kind: "warn-channel-without-id" },
  "warn-channel-unavailable": { kind: "warn-channel-unavailable" },
  "warn-orphaned": { kind: "warn-orphaned" },
  warned: { kind: "warned", count: 2, autoBan: "not-reached" },
  "unknown-command": { kind: "unknown-command" }
};

test("fiecare rezultat posibil are un mesaj propriu pentru utilizator", () => {
  const messages = new Map<string, string>();
  for (const [kind, outcome] of Object.entries(OUTCOME_SAMPLES)) {
    const message = moderationOutcomeMessage(outcome, "Ana (<@u1>)");
    assert.ok(message.length > 0, `${kind} are mesaj`);
    const duplicate = [...messages.entries()].find(([, existing]) => existing === message);
    assert.equal(duplicate, undefined, `${kind} si ${duplicate?.[0]} nu pot avea acelasi mesaj: userul nu ar sti ce s-a intamplat`);
    messages.set(kind, message);
  }
  assert.equal(messages.size, Object.keys(OUTCOME_SAMPLES).length);
});

test("mesajele de eliminare a sanctiunii trimit userul catre comanda corecta", () => {
  assert.match(
    moderationOutcomeMessage({ kind: "wrong-sanction-type", has: "mute", asked: "timeout" }, "Ana"),
    /are mute, nu timeout\. Foloseste `\/unmute`/
  );
  assert.match(
    moderationOutcomeMessage({ kind: "wrong-sanction-type", has: "timeout", asked: "mute" }, "Ana"),
    /are timeout, nu mute\. Foloseste `\/remove-timeout`/
  );
});
