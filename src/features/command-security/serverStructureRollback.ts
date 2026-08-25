"use strict";

import type { StructureChangeKind } from "./serverStructureActions.js";
import type { ProtectedResourceSnapshot } from "./protectedResourceTypes.js";

export type StructureRollbackOperation = "remove-created" | "recreate-deleted";

export const ROLLBACK_OPERATIONS: Record<StructureChangeKind, StructureRollbackOperation> = {
  channelCreate: "remove-created",
  roleCreate: "remove-created",
  channelDelete: "recreate-deleted",
  roleDelete: "recreate-deleted"
};

export interface StructureRollbackPort {
  removeCreatedResource(kind: StructureChangeKind, resourceId: string, reason: string): Promise<boolean>;
  recreateDeletedResource(kind: StructureChangeKind, snapshot: ProtectedResourceSnapshot): Promise<string | null>;
  resourceExists(kind: StructureChangeKind, resourceId: string): Promise<boolean>;
}

export interface StructureRollbackOutcome {
  operation: StructureRollbackOperation;
  attempted: boolean;
  reverted: boolean;
  verified: boolean;
  recreatedId: string | null;
  reason: string | null;
}

function skipped(operation: StructureRollbackOperation, reason: string): StructureRollbackOutcome {
  return { operation, attempted: false, reverted: false, verified: false, recreatedId: null, reason };
}

async function removeCreated(
  port: StructureRollbackPort,
  kind: StructureChangeKind,
  resourceId: string,
  reason: string
): Promise<StructureRollbackOutcome> {
  const removed = await port.removeCreatedResource(kind, resourceId, reason).catch(() => false);
  if (!removed) {
    return {
      operation: "remove-created",
      attempted: true,
      reverted: false,
      verified: false,
      recreatedId: null,
      reason: "stergerea resursei create fara aprobare a esuat"
    };
  }

  const stillThere = await port.resourceExists(kind, resourceId).catch(() => true);
  return {
    operation: "remove-created",
    attempted: true,
    reverted: !stillThere,
    verified: !stillThere,
    recreatedId: null,
    reason: stillThere ? "resursa creata fara aprobare inca exista dupa stergere" : null
  };
}

async function recreateDeleted(
  port: StructureRollbackPort,
  kind: StructureChangeKind,
  snapshot: ProtectedResourceSnapshot | null
): Promise<StructureRollbackOutcome> {
  if (!snapshot) return skipped("recreate-deleted", "resursa stearsa nu avea snapshot de recreat");

  const recreatedId = await port.recreateDeletedResource(kind, snapshot).catch(() => null);
  if (!recreatedId) {
    return {
      operation: "recreate-deleted",
      attempted: true,
      reverted: false,
      verified: false,
      recreatedId: null,
      reason: "recrearea resursei sterse fara aprobare a esuat"
    };
  }

  const exists = await port.resourceExists(kind, recreatedId).catch(() => false);
  return {
    operation: "recreate-deleted",
    attempted: true,
    reverted: true,
    verified: exists,
    recreatedId,
    reason: exists ? null : "resursa recreata nu a putut fi confirmata"
  };
}

export async function executeStructureRollback(
  port: StructureRollbackPort,
  kind: StructureChangeKind,
  resourceId: string,
  snapshot: ProtectedResourceSnapshot | null,
  reason: string
): Promise<StructureRollbackOutcome> {
  const operation = ROLLBACK_OPERATIONS[kind];
  return operation === "remove-created"
    ? removeCreated(port, kind, resourceId, reason)
    : recreateDeleted(port, kind, snapshot);
}

export function describeStructureRollback(outcome: StructureRollbackOutcome): string {
  if (!outcome.attempted) return `Revenire neincercata: ${outcome.reason ?? "motiv necunoscut"}.`;
  if (outcome.operation === "remove-created") {
    return outcome.verified
      ? "Revenire: resursa creata fara aprobare a fost stearsa si absenta ei e confirmata."
      : `Revenire incompleta: ${outcome.reason ?? "stergerea nu a putut fi confirmata"}.`;
  }
  if (!outcome.recreatedId) return `Revenire incompleta: ${outcome.reason ?? "recrearea nu a reusit"}.`;
  return outcome.verified
    ? `Revenire: resursa stearsa a fost recreata ca \`${outcome.recreatedId}\`; permisiunile si pozitia se verifica de owner.`
    : `Revenire partiala: resursa a fost recreata ca \`${outcome.recreatedId}\`, dar prezenta ei nu a putut fi confirmata.`;
}
