"use strict";

import { type SanctionRole } from "./elevatedRoleSanction.js";
import { describeSanctionOutcome, executeElevatedRoleSanction } from "./elevatedRoleSanction.js";

import { STRUCTURE_ACTIONS, STRUCTURE_CHANGE_KINDS } from "./serverStructureActions.js";

import type { StructureChangeKind } from "./serverStructureActions.js";
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

export interface StructureGuardGuild {
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
  signalAntiRaid: (guildId: string, resourceId: string) => Promise<unknown>;
  logger?: (level: LogLevel, scope: string, message: string, meta?: Record<string, unknown>) => void;
}

export type StructureGuardOutcome =
  | { kind: "allowed-owner" }
  | { kind: "allowed-approval"; requestId: string }
  | { kind: "signalled"; actorId: string | null }
  | { kind: "sanctioned"; actorId: string };

const REASON = "Protectie moderation-guard: modificare de structura fara aprobare de tip server-structure";

export function createServerStructureGuardRuntime(deps: ServerStructureGuardDeps) {
  async function sanction(guild: StructureGuardGuild, actorId: string, kind: StructureChangeKind, resourceId: string): Promise<void> {
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
      action: "server-structure-unapproved",
      details: `tip=${kind}; resursa=${resourceId}`
    }).catch(() => undefined);

    const lines = [
      `<@${actorId}> a modificat structura serverului fara aprobare.`,
      `Modificare: ${STRUCTURE_LABELS[kind]} \`${resourceId}\``,
      "Motiv: fara aprobare activa de tip server-structure",
      "Modificarile de structura NU se anuleaza automat in afara unui raid; verificarea si revenirea raman la owner.",
      describeSanctionOutcome(outcome)
    ];
    await deps.publish(guild.id, lines.join("\n")).catch(() => undefined);
  }

  async function handleStructureChange(
    guild: StructureGuardGuild,
    kind: StructureChangeKind,
    resourceId: string
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

    await deps.signalAntiRaid(guild.id, resourceId).catch(() => undefined);

    if (!situation.guardEnabled || situation.raidConfirmed || !actorId) return { kind: "signalled", actorId };

    await sanction(guild, actorId, kind, resourceId);
    return { kind: "sanctioned", actorId };
  }

  return { handleStructureChange };
}

export interface ServerStructureGuardRuntime {
  handleStructureChange: (
    guild: StructureGuardGuild,
    kind: StructureChangeKind,
    resourceId: string
  ) => Promise<StructureGuardOutcome>;
}
