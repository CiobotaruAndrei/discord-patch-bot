"use strict";

import { createProtectedResourceRepository } from "./protectedResourceRepository.js";
import { captureSnapshot, diffSnapshot } from "./protectedResourceTypes.js";
import { renderIncident } from "./protectedResourceSanction.js";
import { ACTOR_UNKNOWN_OUTCOME, executeElevatedRoleSanction } from "./elevatedRoleSanction.js";

import type { ProtectedResourceModelLike } from "./protectedResourceRepository.js";
import type { ProtectedResourceRecord, ProtectedResourceSnapshot, ResourceLike } from "./protectedResourceTypes.js";
import type { SanctionRole } from "./elevatedRoleSanction.js";
import type { SanctionOutcome } from "./elevatedRoleSanction.js";

export interface ProtectedResourceGuardGate {
  readSituation(guildId: string): Promise<{ guardEnabled: boolean; raidConfirmed: boolean }>;
  consumeResourceApproval(
    guildId: string,
    requesterId: string,
    resourceId: string,
    actions: readonly string[]
  ): Promise<{ _id: string }[] | null>;
}

export interface ProtectedActor {
  id: string;
  roles: readonly SanctionRole[];
  removeRoles(roleIds: readonly string[], reason: string): Promise<unknown>;
}

export interface ProtectedResourceGuild {
  id: string;
  ownerId?: string | null;
  everyoneRoleId: string;
  botHighestRolePosition: number | null;
  resolveActor(actorId: string): Promise<ProtectedActor | null>;
  findAuditActor(resourceId: string): Promise<string | null>;
  restoreChannel(resourceId: string, snapshot: ProtectedResourceSnapshot): Promise<boolean>;
  restoreRole(resourceId: string, snapshot: ProtectedResourceSnapshot): Promise<boolean>;
  recreateChannel(snapshot: ProtectedResourceSnapshot): Promise<string | null>;
  recreateRole(snapshot: ProtectedResourceSnapshot): Promise<string | null>;
}

export interface ProtectedResourceRuntimeDeps {
  ProtectedResourceModel: ProtectedResourceModelLike;
  guard: ProtectedResourceGuardGate;
  publish(guildId: string, body: string): Promise<unknown>;
  logger?: (level: string, scope: string, message: string, detail?: Record<string, unknown>) => void;
  now?: () => number;
}

export type EnforcementOutcome =
  | { kind: "not-protected" }
  | { kind: "guard-off" }
  | { kind: "raid-active" }
  | { kind: "no-change" }
  | { kind: "allowed-owner" }
  | { kind: "allowed-approval"; requestId: string }
  | { kind: "actor-unknown"; actions: readonly string[]; restored: boolean; recreatedId: string | null }
  | { kind: "corrected"; actions: readonly string[]; restored: boolean; recreatedId: string | null };

export function createProtectedResourceRuntime(deps: ProtectedResourceRuntimeDeps) {
  const repository = createProtectedResourceRepository(deps.ProtectedResourceModel);
  const now = deps.now ?? Date.now;

  async function gateOpen(guildId: string): Promise<EnforcementOutcome | null> {
    const situation = await deps.guard.readSituation(guildId).catch(() => null);
    if (!situation || !situation.guardEnabled) return { kind: "guard-off" };
    if (situation.raidConfirmed) return { kind: "raid-active" };
    return null;
  }

  async function authorize(
    guild: ProtectedResourceGuild,
    record: ProtectedResourceRecord,
    actions: readonly string[]
  ): Promise<{ outcome: EnforcementOutcome } | { actorId: string | null }> {
    const actorId = await guild.findAuditActor(record.resourceId).catch(() => null);
    if (!actorId) return { actorId: null };
    if (guild.ownerId && actorId === guild.ownerId) return { outcome: { kind: "allowed-owner" } };

    const requested = actions.length > 0 ? actions : ["permissions"];
    const approvals = await deps.guard
      .consumeResourceApproval(guild.id, actorId, record.resourceId, requested)
      .catch(() => null);
    if (approvals && approvals.length === requested.length) {
      return { outcome: { kind: "allowed-approval", requestId: approvals.map(entry => entry._id).join(",") } };
    }
    return { actorId };
  }

  async function sanction(
    guild: ProtectedResourceGuild,
    actorId: string | null,
    record: ProtectedResourceRecord,
    actions: readonly string[],
    restored: boolean,
    recreatedId: string | null
  ): Promise<SanctionOutcome> {
    const outcome = actorId
      ? await executeElevatedRoleSanction({
        resolveActor: () => guild.resolveActor(actorId),
        botHighestRolePosition: guild.botHighestRolePosition,
        everyoneRoleId: guild.everyoneRoleId,
        reason: "Protectie resurse: modificare neautorizata a unei resurse protejate"
      })
      : ACTOR_UNKNOWN_OUTCOME;

    if (outcome.ownerInterventionRequired) {
      await repository.markOwnerInterventionRequired(guild.id, record.resourceId, new Date(now())).catch(() => false);
      deps.logger?.("ERROR", "PROTECTED_RESOURCE", "Sanctiunea autorului nu s-a aplicat complet", {
        guildId: guild.id,
        actorId,
        resourceId: record.resourceId,
        blocked: outcome.blocked.length,
        failed: outcome.failed.length,
        verified: outcome.verified
      });
    }

    await deps
      .publish(guild.id, renderIncident({
        actorId,
        resourceLabel: `${record.type} \`${record.resourceId}\` (${record.snapshot.name || "fara nume salvat"})`,
        actions,
        restored,
        recreatedId,
        outcome
      }))
      .catch(() => undefined);

    return outcome;
  }

  async function handleResourceUpdate(
    guild: ProtectedResourceGuild,
    resourceId: string,
    current: ResourceLike
  ): Promise<EnforcementOutcome> {
    const record = await repository.read(guild.id, resourceId).catch(() => null);
    if (!record) return { kind: "not-protected" };

    const blocked = await gateOpen(guild.id);
    if (blocked) {
      await repository.refreshSnapshot(guild.id, resourceId, captureSnapshot(current), new Date(now())).catch(() => false);
      return blocked;
    }

    const actions = diffSnapshot(record.snapshot, captureSnapshot(current));
    if (actions.length === 0) return { kind: "no-change" };

    const decision = await authorize(guild, record, actions);
    if ("outcome" in decision) {
      if (decision.outcome.kind === "allowed-owner" || decision.outcome.kind === "allowed-approval") {
        await repository.refreshSnapshot(guild.id, resourceId, captureSnapshot(current), new Date(now())).catch(() => false);
      }
      return decision.outcome;
    }

    if (!decision.actorId) {
      await sanction(guild, null, record, actions, false, null);
      return { kind: "actor-unknown", actions, restored: false, recreatedId: null };
    }

    const restored = record.type === "role"
      ? await guild.restoreRole(resourceId, record.snapshot).catch(() => false)
      : await guild.restoreChannel(resourceId, record.snapshot).catch(() => false);
    if (restored) await repository.markRestored(guild.id, resourceId, new Date(now())).catch(() => false);

    await sanction(guild, decision.actorId, record, actions, restored, null);
    return { kind: "corrected", actions, restored, recreatedId: null };
  }

  async function handleResourceDelete(guild: ProtectedResourceGuild, resourceId: string): Promise<EnforcementOutcome> {
    const record = await repository.read(guild.id, resourceId).catch(() => null);
    if (!record) return { kind: "not-protected" };

    const blocked = await gateOpen(guild.id);
    if (blocked) {
      if (blocked.kind === "raid-active") {
        await repository.markDeletedDuringRaid(guild.id, resourceId, new Date(now())).catch(() => false);
      } else {
        await repository.remove(guild.id, resourceId).catch(() => false);
      }
      return blocked;
    }

    const decision = await authorize(guild, record, ["delete"]);
    if ("outcome" in decision) {
      if (decision.outcome.kind === "allowed-owner" || decision.outcome.kind === "allowed-approval") {
        await repository.remove(guild.id, resourceId).catch(() => false);
      }
      return decision.outcome;
    }

    if (!decision.actorId) {
      await sanction(guild, null, record, ["delete"], false, null);
      return { kind: "actor-unknown", actions: ["delete"], restored: false, recreatedId: null };
    }

    const recreatedId = record.type === "role"
      ? await guild.recreateRole(record.snapshot).catch(() => null)
      : await guild.recreateChannel(record.snapshot).catch(() => null);
    if (recreatedId) {
      await repository.rebind(guild.id, resourceId, recreatedId, new Date(now())).catch(() => null);
    } else {
      deps.logger?.("WARN", "PROTECTED_RESOURCE", "Resursa protejata nu a putut fi recreata din snapshot", {
        guildId: guild.id,
        resourceId
      });
    }

    await sanction(guild, decision.actorId, record, ["delete"], Boolean(recreatedId), recreatedId);
    return { kind: "corrected", actions: ["delete"], restored: Boolean(recreatedId), recreatedId };
  }

  return { handleResourceUpdate, handleResourceDelete };
}

export type ProtectedResourceRuntime = ReturnType<typeof createProtectedResourceRuntime>;
