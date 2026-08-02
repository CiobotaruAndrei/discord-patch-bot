"use strict";

export interface SanctionRole {
  id: string;
  name: string;
  position: number;
  managed: boolean;
  elevated: boolean;
}

export interface SanctionInput {
  actorRoles: readonly SanctionRole[];
  botHighestRolePosition: number | null;
  everyoneRoleId: string;
}

export interface SanctionPlan {
  removable: SanctionRole[];
  blocked: SanctionRole[];
}

export function planRoleSanction(input: SanctionInput): SanctionPlan {
  const removable: SanctionRole[] = [];
  const blocked: SanctionRole[] = [];
  const botPosition = input.botHighestRolePosition;

  for (const role of input.actorRoles) {
    if (!role.elevated || role.id === input.everyoneRoleId) continue;
    if (role.managed || botPosition === null || role.position >= botPosition) {
      blocked.push(role);
      continue;
    }
    removable.push(role);
  }

  return { removable, blocked };
}

export interface SanctionActorLike {
  roles: readonly SanctionRole[];
  removeRoles(roleIds: readonly string[], reason: string): Promise<unknown>;
}

export interface SanctionExecution {
  resolveActor: () => Promise<SanctionActorLike | null>;
  botHighestRolePosition: number | null;
  everyoneRoleId: string;
  reason: string;
}

export interface SanctionOutcome {
  actorKnown: boolean;
  attempted: boolean;
  removed: SanctionRole[];
  blocked: SanctionRole[];
  failed: SanctionRole[];
  verified: boolean;
  ownerInterventionRequired: boolean;
}

export const SANCTION_UNAVAILABLE_OUTCOME: SanctionOutcome = {
  actorKnown: true,
  attempted: false,
  removed: [],
  blocked: [],
  failed: [],
  verified: false,
  ownerInterventionRequired: true
};

export const ACTOR_UNKNOWN_OUTCOME: SanctionOutcome = {
  actorKnown: false,
  attempted: false,
  removed: [],
  blocked: [],
  failed: [],
  verified: false,
  ownerInterventionRequired: true
};

export async function executeElevatedRoleSanction(execution: SanctionExecution): Promise<SanctionOutcome> {
  const actor = await execution.resolveActor().catch(() => null);
  if (!actor) return ACTOR_UNKNOWN_OUTCOME;

  const plan = planRoleSanction({
    actorRoles: actor.roles,
    botHighestRolePosition: execution.botHighestRolePosition,
    everyoneRoleId: execution.everyoneRoleId
  });

  if (plan.removable.length === 0) {
    return {
      actorKnown: true,
      attempted: true,
      removed: [],
      blocked: plan.blocked,
      failed: [],
      verified: true,
      ownerInterventionRequired: plan.blocked.length > 0
    };
  }

  await actor.removeRoles(plan.removable.map(role => role.id), execution.reason).catch(() => undefined);

  const after = await execution.resolveActor().catch(() => null);
  if (!after) {
    return {
      actorKnown: true,
      attempted: true,
      removed: [],
      blocked: plan.blocked,
      failed: plan.removable,
      verified: false,
      ownerInterventionRequired: true
    };
  }

  const stillHeld = new Set(after.roles.map(role => role.id));
  const failed = plan.removable.filter(role => stillHeld.has(role.id));

  return {
    actorKnown: true,
    attempted: true,
    removed: plan.removable.filter(role => !stillHeld.has(role.id)),
    blocked: plan.blocked,
    failed,
    verified: true,
    ownerInterventionRequired: failed.length > 0 || plan.blocked.length > 0
  };
}

function names(roles: readonly SanctionRole[]): string {
  return roles.map(role => role.name).join(", ");
}

export function describeSanctionOutcome(outcome: SanctionOutcome): string {
  if (!outcome.actorKnown) {
    return "Autorul nu a putut fi confirmat, deci nicio sanctiune nu a fost aplicata; interventia ownerului este necesara.";
  }
  if (!outcome.attempted) {
    return "Sanctionarea autorului nu a putut fi initiata pentru ca serverul nu a putut fi citit; interventia ownerului este necesara.";
  }

  const parts: string[] = [];
  if (outcome.removed.length > 0) parts.push(`Roluri eliminate si verificate: ${names(outcome.removed)}.`);
  if (outcome.blocked.length > 0) {
    parts.push(`Roluri care NU au putut fi eliminate (gestionate de integrare sau peste rolul botului): ${names(outcome.blocked)}.`);
  }
  if (outcome.failed.length > 0) {
    parts.push(
      outcome.verified
        ? `Roluri pe care autorul le are inca dupa incercarea de eliminare: ${names(outcome.failed)}.`
        : `Eliminarea nu a putut fi verificata; autorul poate avea inca: ${names(outcome.failed)}.`
    );
  }
  if (parts.length === 0) return "Autorul nu avea roluri cu permisiuni ridicate.";
  if (outcome.ownerInterventionRequired) parts.push("Interventia ownerului este necesara.");
  return parts.join(" ");
}
