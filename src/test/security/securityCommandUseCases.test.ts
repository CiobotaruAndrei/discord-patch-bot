import test from "node:test";
import assert from "node:assert/strict";

import { applyChannelLock } from "../../features/command-security/channelLockUseCase.js";
import { purgeMessages } from "../../features/command-security/purgeMessagesUseCase.js";
import { toggleProtection } from "../../features/command-security/toggleProtectionUseCase.js";
import type { ChannelLockDeps } from "../../features/command-security/channelLockUseCase.js";
import type { ToggleProtectionDeps } from "../../features/command-security/toggleProtectionUseCase.js";

function lockDeps(overrides: Partial<ChannelLockDeps> = {}): { deps: ChannelLockDeps; log: string[] } {
  const log: string[] = [];
  const deps: ChannelLockDeps = {
    canEditOverwrites: () => true,
    readBotPermissions: () => ({ missing: [] }),
    canSendNotice: () => true,
    validateReason: raw => raw,
    readPreviousState: () => "allow",
    applyOverwrite: async locked => { log.push(`overwrite:${locked}`); },
    persistState: async (previous, locked) => { log.push(`persist:${previous}:${locked}`); },
    revertOverwrite: async locked => { log.push(`revert-overwrite:${locked}`); return true; },
    recordDivergence: async () => { log.push("record-divergence"); return true; },
    sendNotice: async reason => { log.push(`notice:${reason ?? ""}`); },
    revertPersistence: async () => { log.push("revert-persistence"); return true; },
    ...overrides
  };
  return { deps, log };
}

test("lock: ordinea verificarilor opreste inainte de a atinge Discord", async () => {
  for (const [override, expected] of [
    [{ canEditOverwrites: () => false }, "channel-not-editable"],
    [{ readBotPermissions: () => null }, "permissions-unreadable"],
    [{ readBotPermissions: () => ({ missing: ["Manage Roles"] }) }, "missing-permissions"],
    [{ canSendNotice: () => false }, "channel-cannot-receive-notice"]
  ] as Array<[Partial<ChannelLockDeps>, string]>) {
    const { deps, log } = lockDeps(override);
    const outcome = await applyChannelLock({ command: "lock-channel", rawReason: "motiv", hasAttachment: false, isLocked: false }, deps);
    assert.equal(outcome.kind, expected);
    assert.deepEqual(log, [], `${expected}: nicio permisiune Discord nu a fost atinsa`);
  }
});

test("lock: un canal deja blocat nu se reblocheaza, iar unlock pe un canal liber e refuzat", async () => {
  const locked = await applyChannelLock({ command: "lock-channel", rawReason: "m", hasAttachment: false, isLocked: true }, lockDeps().deps);
  assert.equal(locked.kind, "already-locked");
  const free = await applyChannelLock({ command: "unlock-channel", rawReason: null, hasAttachment: false, isLocked: false }, lockDeps().deps);
  assert.equal(free.kind, "not-locked");
});

test("lock: blocarea fara motiv si fara atasament e refuzata, cu atasament trece", async () => {
  const refused = await applyChannelLock({ command: "lock-channel", rawReason: null, hasAttachment: false, isLocked: false }, lockDeps().deps);
  assert.equal(refused.kind, "reason-required");
  const { deps, log } = lockDeps();
  const accepted = await applyChannelLock({ command: "lock-channel", rawReason: null, hasAttachment: true, isLocked: false }, deps);
  assert.equal(accepted.kind, "applied");
  assert.deepEqual(log, ["overwrite:true", "persist:allow:true", "notice:"]);
});

test("lock: un motiv invalid e raportat inainte de orice scriere", async () => {
  const { deps, log } = lockDeps({
    validateReason: () => { throw new Error("Eroare: motivul depaseste limita."); }
  });
  const outcome = await applyChannelLock({ command: "lock-channel", rawReason: "x".repeat(9999), hasAttachment: false, isLocked: false }, deps);
  assert.deepEqual(outcome, { kind: "invalid-reason", message: "Eroare: motivul depaseste limita." });
  assert.deepEqual(log, []);
});

test("lock: persistenta esuata cu rollback reusit propaga eroarea, nu raporteaza succes", async () => {
  const { deps, log } = lockDeps({
    persistState: async () => { throw new Error("mongo down"); }
  });
  const outcome = await applyChannelLock({ command: "lock-channel", rawReason: "m", hasAttachment: false, isLocked: false }, deps);
  assert.equal(outcome.kind, "failed", "rollback-ul reusit inseamna ca operatia a eșuat curat");
  assert.deepEqual(log, ["overwrite:true", "revert-overwrite:false"], "permisiunea Discord a fost readusa la starea deblocata");
});

test("lock: persistenta esuata SI rollback esuat inregistreaza divergenta", async () => {
  const { deps, log } = lockDeps({
    persistState: async () => { throw new Error("mongo down"); },
    revertOverwrite: async () => false
  });
  const outcome = await applyChannelLock({ command: "lock-channel", rawReason: "m", hasAttachment: false, isLocked: false }, deps);
  assert.deepEqual(outcome, { kind: "diverged", command: "lock-channel", previous: "allow", recoveryScheduled: true });
  assert.ok(log.includes("record-divergence"), "divergenta e inregistrata pentru recovery automat");
});

test("unlock: rollback-ul dupa persistenta esuata readuce canalul in starea blocata", async () => {
  const { deps, log } = lockDeps({
    readPreviousState: () => "allow",
    persistState: async () => { throw new Error("mongo down"); }
  });
  const outcome = await applyChannelLock({ command: "unlock-channel", rawReason: null, hasAttachment: false, isLocked: true }, deps);
  assert.equal(outcome.kind, "failed");
  assert.deepEqual(log, ["overwrite:false", "revert-overwrite:true"], "deblocarea se anuleaza reblocand canalul");
});

test("lock: mesajul de blocare esuat cu compensare completa propaga eroarea", async () => {
  const { deps, log } = lockDeps({
    sendNotice: async () => { throw new Error("no perms"); }
  });
  const outcome = await applyChannelLock({ command: "lock-channel", rawReason: "m", hasAttachment: false, isLocked: false }, deps);
  assert.equal(outcome.kind, "failed");
  assert.deepEqual(log, ["overwrite:true", "persist:allow:true", "revert-persistence", "revert-overwrite:false"]);
});

test("lock: compensare partiala dupa mesaj esuat raporteaza exact ce a revenit", async () => {
  const { deps } = lockDeps({
    sendNotice: async () => { throw new Error("no perms"); },
    revertPersistence: async () => false
  });
  const outcome = await applyChannelLock({ command: "lock-channel", rawReason: "m", hasAttachment: false, isLocked: false }, deps);
  assert.deepEqual(outcome, { kind: "notice-failed", persistenceReverted: false, discordReverted: true });
});

test("purge: limitele si permisiunile sunt verificate inainte de stergere", async () => {
  let deleted = 0;
  const deps = {
    canBulkDelete: () => true,
    missingPermissions: () => [] as readonly string[],
    bulkDelete: async (amount: number) => { deleted = amount; return amount - 3; }
  };
  assert.equal((await purgeMessages({ amount: 0 }, deps)).kind, "invalid-amount");
  assert.equal((await purgeMessages({ amount: 101 }, deps)).kind, "invalid-amount");
  assert.equal(deleted, 0, "o cantitate invalida nu ajunge la Discord");

  assert.equal((await purgeMessages({ amount: 10 }, { ...deps, canBulkDelete: () => false })).kind, "channel-not-purgeable");
  assert.equal(
    (await purgeMessages({ amount: 10 }, { ...deps, missingPermissions: () => ["Manage Messages"] })).kind,
    "missing-permissions"
  );

  const purged = await purgeMessages({ amount: 10 }, deps);
  assert.deepEqual(purged, { kind: "purged", requested: 10, deleted: 7, skipped: 3 }, "mesajele mai vechi de 14 zile sunt raportate ca omise");
});

test("purge: o eroare Discord e raportata, nu inghitita", async () => {
  const outcome = await purgeMessages({ amount: 5 }, {
    canBulkDelete: () => true,
    missingPermissions: () => [],
    bulkDelete: async () => { throw new Error("rate limited"); }
  });
  assert.equal(outcome.kind, "purge-failed");
});

function toggleDeps(overrides: Partial<ToggleProtectionDeps> = {}): { deps: ToggleProtectionDeps; log: string[] } {
  const log: string[] = [];
  const deps: ToggleProtectionDeps = {
    readConfiguredChannel: () => "chan-1",
    readChannelPermissions: async () => ({ viewChannel: true, sendMessages: true, embedLinks: true }),
    readinessGaps: () => [],
    countActiveApprovals: () => 4,
    stopAtomically: async () => { log.push("stop-atomically"); },
    persistEnabled: async enabled => { log.push(`persist:${enabled}`); },
    runBackfill: async () => { log.push("backfill"); return { delivered: 2, sentUnconfirmed: 0, undetermined: 0 }; },
    ...overrides
  };
  return { deps, log };
}

test("toggle: pornirea fara canal configurat nu scrie nimic", async () => {
  const { deps, log } = toggleDeps({ readConfiguredChannel: () => null });
  const outcome = await toggleProtection(
    { command: "start", subcommand: "threat-protection", hasToggleFields: true, needsReadinessCheck: false, needsAtomicStop: false, needsBackfill: false },
    deps
  );
  assert.equal(outcome.kind, "channel-not-set");
  assert.deepEqual(log, []);
});

test("toggle: pornirea cu permisiuni pierdute pe canalul configurat e refuzata", async () => {
  const { deps, log } = toggleDeps({ readChannelPermissions: async () => ({ viewChannel: true, sendMessages: true, embedLinks: false }) });
  const outcome = await toggleProtection(
    { command: "start", subcommand: "threat-protection", hasToggleFields: true, needsReadinessCheck: false, needsAtomicStop: false, needsBackfill: false },
    deps
  );
  assert.equal(outcome.kind, "channel-missing-permissions");
  assert.deepEqual(log, [], "comutatorul nu se activeaza cat timp canalul nu poate primi alerte");
});

test("toggle: oprirea protectiei bot-add anuleaza atomic aprobarile active", async () => {
  const { deps, log } = toggleDeps();
  const outcome = await toggleProtection(
    { command: "stop", subcommand: "moderation-guard", hasToggleFields: true, needsReadinessCheck: false, needsAtomicStop: true, needsBackfill: false },
    deps
  );
  assert.deepEqual(outcome, { kind: "stopped-with-cancellations", subcommand: "moderation-guard", cancelled: 4 });
  assert.deepEqual(log, ["stop-atomically"], "comutatorul nu se scrie separat: oprirea e o singura operatie atomica");
});

test("toggle: daca anularea atomica esueaza, protectia ramane activa", async () => {
  const { deps, log } = toggleDeps({ stopAtomically: async () => { throw new Error("mongo down"); } });
  const outcome = await toggleProtection(
    { command: "stop", subcommand: "moderation-guard", hasToggleFields: true, needsReadinessCheck: false, needsAtomicStop: true, needsBackfill: false },
    deps
  );
  assert.equal(outcome.kind, "atomic-stop-failed");
  assert.deepEqual(log, [], "starea anterioara nu a fost modificata");
});

test("toggle: un backfill esuat readuce comutatorul pe oprit si propaga eroarea", async () => {
  const { deps, log } = toggleDeps({ runBackfill: async () => { throw new Error("discord down"); } });
  await assert.rejects(
    () => toggleProtection(
      { command: "start", subcommand: "new-account-alerts", hasToggleFields: true, needsReadinessCheck: false, needsAtomicStop: false, needsBackfill: true },
      deps
    ),
    /discord down/
  );
  assert.deepEqual(log, ["persist:true", "persist:false"], "comutatorul nu rămâne pornit dupa un backfill eșuat");
});

test("toggle: pornirea obisnuita doar scrie comutatorul", async () => {
  const { deps, log } = toggleDeps();
  const outcome = await toggleProtection(
    { command: "start", subcommand: "threat-protection", hasToggleFields: true, needsReadinessCheck: false, needsAtomicStop: false, needsBackfill: false },
    deps
  );
  assert.deepEqual(outcome, { kind: "toggled", subcommand: "threat-protection", command: "start" });
  assert.deepEqual(log, ["persist:true"]);
});
