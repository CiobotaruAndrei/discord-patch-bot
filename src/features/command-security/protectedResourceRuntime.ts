"use strict";

import { createProtectedResourceRepository } from "./protectedResourceRepository.js";
import { captureSnapshot, diffSnapshot } from "./protectedResourceTypes.js";
import { planRoleSanction, renderIncident } from "./protectedResourceSanction.js";

import type { ProtectedResourceModelLike } from "./protectedResourceRepository.js";
import type { ProtectedResourceRecord, ProtectedResourceSnapshot, ResourceLike } from "./protectedResourceTypes.js";
import type { SanctionRole } from "./protectedResourceSanction.js";

export interface ProtectedResourceGuardGate {
  readSituation(guildId: string): Promise<{ guardEnabled: boolean; raidConfirmed: boolean }>;
  consumeResourceApproval(guildId: string, requesterId: string, resourceId: string, action: string): Promise<{ _id: string } | null>;
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
  | { kind: "actor-unknown"; actions: readonly string[] }
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
  ): Promise<{ outcome: EnforcementOutcome } | { actorId: string }> {
    const actorId = await guild.findAuditActor(record.resourceId).catch(() => null);
    if (!actorId) return { outcome: { kind: "actor-unknown", actions } };
    if (guild.ownerId && actorId === guild.ownerId) return { outcome: { kind: "allowed-owner" } };

    const approval = await deps.guard
      .consumeResourceApproval(guild.id, actorId, record.resourceId, actions[0] ?? "permissions")
      .catch(() => null);
    if (approval) return { outcome: { kind: "allowed-approval", requestId: approval._id } };
    return { actorId };
  }

  async function sanction(
    guild: ProtectedResourceGuild,
    actorId: string,
    record: ProtectedResourceRecord,
    actions: readonly string[],
    restored: boolean,
    recreatedId: string | null
  ): Promise<void> {
    const actor = await guild.resolveActor(actorId).catch(() => null);
    const plan = planRoleSanction({
      actorRoles: actor?.roles ?? [],
      botHighestRolePosition: guild.botHighestRolePosition,
      everyoneRoleId: guild.everyoneRoleId
    });

    if (actor && plan.removable.length > 0) {
      await actor
        .removeRoles(plan.removable.map(role => role.id), "Protectie resurse: modificare neautorizata a unei resurse protejate")
        .catch(error => {
          deps.logger?.("WARN", "PROTECTED_RESOURCE", "Eliminarea rolurilor autorului a esuat", {
            guildId: guild.id,
            actorId,
            error: error instanceof Error ? error.message : String(error)
          });
        });
    }

    await deps
      .publish(guild.id, renderIncident({
        actorId,
        resourceLabel: `${record.type} \`${record.resourceId}\` (${record.snapshot.name || "fara nume salvat"})`,
        actions,
        restored,
        recreatedId,
        plan
      }))
      .catch(() => undefined);
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
      await repository.remove(guild.id, resourceId).catch(() => false);
      return blocked;
    }

    const decision = await authorize(guild, record, ["delete"]);
    if ("outcome" in decision) {
      if (decision.outcome.kind === "allowed-owner" || decision.outcome.kind === "allowed-approval") {
        await repository.remove(guild.id, resourceId).catch(() => false);
      }
      return decision.outcome;
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
