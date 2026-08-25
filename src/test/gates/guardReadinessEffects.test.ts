import test from "node:test";
import assert from "node:assert/strict";

import { MODERATION_GUARD_TYPES } from "../../features/command-security/moderationGuardDecision.js";
import { READINESS_EFFECTS, requirementsCoverEffects } from "../../features/command-security/moderationGuardReadiness.js";
import { MODERATION_GUARD_ENFORCERS } from "../../features/command-security/moderationGuardEnforcers.js";
import { calls, loadModule } from "./sourceStructureQueries.js";

const EFFECT_CALLS: Readonly<Record<string, readonly string[]>> = {
  kick: ["kick.call"],
  "sanctiune roluri": ["executeElevatedRoleSanction", "sanctionDelegationAuthor"],
  "rollback canal": ["executeStructureRollback"],
  "rollback rol": ["executeStructureRollback"],
  "restaurare canal": ["guild.restoreChannel"],
  "restaurare rol": ["guild.restoreRole"],
  "corectie webhook": ["channel.deleteWebhook", "channel.editWebhook", "channel.recreateWebhook"]
};

test("fiecare subprotectie isi declara efectele, fara omisiuni", () => {
  assert.deepEqual(
    [...MODERATION_GUARD_TYPES].sort(),
    Object.keys(READINESS_EFFECTS).sort(),
    "o subprotectie fara efecte declarate nu poate avea readiness derivat din ce face runtime-ul"
  );
});

test("permisiunile declarate acopera fiecare efect al subprotectiei (F-18)", () => {
  const gaps = MODERATION_GUARD_TYPES.flatMap(type =>
    requirementsCoverEffects(type).map(gap => `${type}: ${gap}`));

  assert.deepEqual(
    gaps,
    [],
    "un efect fara permisiunea lui inseamna ca subprotectia apare ready si esueaza abia cand incearca sa corecteze"
  );
});

test("efectele declarate exista chiar in codul enforcerului, nu doar in tabel (F-18)", () => {
  const unbacked: string[] = [];

  for (const enforcer of MODERATION_GUARD_ENFORCERS) {
    const used = new Set(
      enforcer.modules.flatMap(name => calls(loadModule("features", "command-security", `${name}.ts`)).map(call => call.callee))
    );
    for (const effect of READINESS_EFFECTS[enforcer.type]) {
      const candidates = EFFECT_CALLS[effect];
      if (!candidates) continue;
      if (!candidates.some(callee => used.has(callee))) unbacked.push(`${enforcer.type}: ${effect}`);
    }
  }

  assert.deepEqual(
    unbacked,
    [],
    "un efect declarat pe care runtime-ul nu il mai executa cere o permisiune degeaba si ascunde ce s-a pierdut"
  );
});
