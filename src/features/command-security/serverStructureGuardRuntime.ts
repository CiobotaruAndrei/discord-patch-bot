"use strict";

import { type SanctionRole } from "./elevatedRoleSanction.js";
import { describeSanctionOutcome, executeElevatedRoleSanction } from "./elevatedRoleSanction.js";

import { STRUCTURE_ACTIONS } from "./serverStructureActions.js";
import { describeStructureRollback, executeStructureRollback } from "./serverStructureRollback.js";

import type { StructureChangeKind } from "./serverStructureActions.js";
import type { StructureRollbackOutcome, StructureRollbackPort } from "./serverStructureRollback.js";
import type { ProtectedResourceSnapshot } from "./protectedResourceTypes.js";
import type { StructureSurface } from "./antiRaidDetection.js";
import type { LogLevel } from "../../shared/logging.js";

const STRUCTURE_LABELS: Record<StructureChangeKind, string> = {
  channelCreate: "canal creat",
  channelDelete: "canal sters",
  roleCreate: "rol creat",
  roleDelete: "rol sters"
};

export interface StructureGuardActor {
  roles: readonly SanctionRole[];
  removeRoles(roleIds: readonly string[], reason: string): Promise<unknown>;
}

export interface StructureGuardGuild extends StructureRollbackPort {
  id: string;
  ownerId: string | null;
  botHighestRolePosition: number | null;
  everyoneRoleId: string;
  findStructureActor(kind: StructureChangeKind, resourceId: string): Promise<string | null>;
  resolveActor(actorId: string): Promise<StructureGuardActor | null>;
}

export interface StructureGuardGate {
  readSituation(guildId: string): Promise<{ guardEnabled: boolean; raidConfirmed: boolean }>;
  consumeApproval(guildId: string, actorId: string, resourceId: string, action: string): Promise<{ _id: string } | null>;
}

export interface ServerStructureGuardDeps {
  gate: StructureGuardGate;
  publish: (guildId: string, message: string) => Promise<void>;
  recordAudit: (guildId: string, entry: { userId: string; action: string; details: string }) => Promise<void>;
  signalAntiRaid: (
    guildId: string,
    resourceId: string,
    change: { surface: StructureSurface; action: string; actorId: string | null; approvalChecked: boolean }
  ) => Promise<unknown>;
  logger?: (level: LogLevel, scope: string, message: string, meta?: Record<string, unknown>) => void;
}

export type StructureGuardOutcome =
  | { kind: "allowed-owner" }
  | { kind: "allowed-approval"; requestId: string }
  | { kind: "signalled"; actorId: string | null; rollback: StructureRollbackOutcome | null }
  | { kind: "sanctioned"; actorId: string; rollback: StructureRollbackOutcome };

const REASON = "Protectie moderation-guard: modificare de structura fara aprobare de tip server-structure";

export function createServerStructureGuardRuntime(deps: ServerStructureGuardDeps) {
  async function rollback(
    guild: StructureGuardGuild,
    kind: StructureChangeKind,
    resourceId: string,
    snapshot: ProtectedResourceSnapshot | null
  ): Promise<StructureRollbackOutcome> {
    const outcome = await executeStructureRollback(guild, kind, resourceId, snapshot, REASON);
    if (!outcome.verified) {
      deps.logger?.("ERROR", "STRUCTURE_GUARD", "Revenirea structurii nu s-a confirmat", {
        guildId: guild.id,
        kind,
        resourceId,
        operation: outcome.operation,
        attempted: outcome.attempted,
        reverted: outcome.reverted,
        reason: outcome.reason
      });
    }
    return outcome;
  }

  async function sanction(
    guild: StructureGuardGuild,
    actorId: string,
    kind: StructureChangeKind,
    resourceId: string,
    reverted: StructureRollbackOutcome
  ): Promise<void> {
    const outcome = await executeElevatedRoleSanction({
      resolveActor: () => guild.resolveActor(actorId),
      botHighestRolePosition: guild.botHighestRolePosition,
      everyoneRoleId: guild.everyoneRoleId,
      reason: REASON
    });

    if (outcome.ownerInterventionRequired) {
      deps.logger?.("ERROR", "STRUCTURE_GUARD", "Sanctiunea autorului nu s-a aplicat complet", {
        guildId: guild.id,
        actorId,
        blocked: outcome.blocked.length,
        failed: outcome.failed.length,
        verified: outcome.verified
      });
    }

    await deps.recordAudit(guild.id, {
      userId: actorId,
      action: reverted.verified ? "server-structure-unapproved-reverted" : "server-structure-unapproved",
      details: `tip=${kind}; resursa=${resourceId}; revenire=${reverted.operation}:${reverted.verified ? "confirmata" : "neconfirmata"}`
    }).catch(() => undefined);

    const lines = [
      `<@${actorId}> a modificat structura serverului fara aprobare.`,
      `Modificare: ${STRUCTURE_LABELS[kind]} \`${resourceId}\``,
      "Motiv: fara aprobare activa de tip server-structure",
      describeStructureRollback(reverted),
      describeSanctionOutcome(outcome)
    ];
    await deps.publish(guild.id, lines.join("\n")).catch(() => undefined);
  }

  async function handleStructureChange(
    guild: StructureGuardGuild,
    kind: StructureChangeKind,
    resourceId: string,
    snapshot: ProtectedResourceSnapshot | null = null
  ): Promise<StructureGuardOutcome> {
    const situation = await deps.gate.readSituation(guild.id).catch(() => ({ guardEnabled: false, raidConfirmed: false }));
    const actorId = await guild.findStructureActor(kind, resourceId).catch(() => null);

    if (actorId && guild.ownerId && actorId === guild.ownerId) return { kind: "allowed-owner" };

    if (situation.guardEnabled && !situation.raidConfirmed && actorId) {
      const approval = await deps.gate
        .consumeApproval(guild.id, actorId, resourceId, STRUCTURE_ACTIONS[kind])
        .catch(() => null);
      if (approval) return { kind: "allowed-approval", requestId: approval._id };
    }

    await deps.signalAntiRaid(guild.id, resourceId, {
      surface: kind === "roleCreate" || kind === "roleDelete" ? "role" : "channel",
      action: STRUCTURE_ACTIONS[kind],
      actorId,
      approvalChecked: situation.guardEnabled && !situation.raidConfirmed && Boolean(actorId)
    }).catch(() => undefined);

    if (!situation.guardEnabled || situation.raidConfirmed) return { kind: "signalled", actorId, rollback: null };

    const reverted = await rollback(guild, kind, resourceId, snapshot);
    if (!actorId) return { kind: "signalled", actorId, rollback: reverted };

    await sanction(guild, actorId, kind, resourceId, reverted);
    return { kind: "sanctioned", actorId, rollback: reverted };
  }

  return { handleStructureChange };
}

export interface ServerStructureGuardRuntime {
  handleStructureChange: (
    guild: StructureGuardGuild,
    kind: StructureChangeKind,
    resourceId: string,
    snapshot?: ProtectedResourceSnapshot | null
  ) => Promise<StructureGuardOutcome>;
}
