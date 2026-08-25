"use strict";

import { createRaidSnapshotRepository } from "./raidSnapshotRepository.js";
import { describeRecovery, planRecovery, recoveryComplete, remapChannelId, remapOverwrites } from "./raidSnapshotTypes.js";

import type { RaidSnapshotModelLike } from "./raidSnapshotRepository.js";
import { chooseIncidentSnapshot, describeBaselineChoice, needsRefresh } from "./raidBaselineSnapshot.js";
import type {
  CurrentServerState,
  RoleRemap,
  RaidSnapshot,
  RecoveryOperation,
  SnapshotChannel,
  SnapshotInvite,
  SnapshotProtections,
  SnapshotRole,
  SnapshotWebhook
} from "./raidSnapshotTypes.js";
import type { LogLevel } from "../../shared/logging.js";

export interface RecoveryGuildPort {
  id: string;
  captureSnapshot(): Promise<RaidSnapshot>;
  readCurrentState(): Promise<CurrentServerState>;
  recreateChannel(channel: SnapshotChannel): Promise<string | null>;
  recreateRole(role: SnapshotRole): Promise<string | null>;
  recreateWebhook(webhook: SnapshotWebhook): Promise<string | null>;
  restoreInvite(invite: SnapshotInvite): Promise<string | null>;
  restoreProtection(field: keyof SnapshotProtections, enabled: boolean): Promise<boolean>;
  publish(body: string): Promise<unknown>;
}

export interface RaidRecoveryDeps {
  RaidSnapshotModel: RaidSnapshotModelLike;
  onResourceRecreated?: (guildId: string, previousResourceId: string, nextResourceId: string) => Promise<unknown>;
  logger?: (level: LogLevel, scope: string, message: string, meta?: Record<string, unknown>) => void;
  now?: () => number;
}

export type CaptureOutcome =
  | { kind: "captured"; source: "frozen-baseline" | "live-capture"; note: string; channels: number; roles: number; webhooks: number; invites: number }
  | { kind: "already-captured" }
  | { kind: "capture-failed"; error: unknown };

export type RecoveryOutcome =
  | { kind: "no-snapshot" }
  | { kind: "nothing-to-restore" }
  | { kind: "restored"; operations: readonly RecoveryOperation[]; complete: boolean };

const MAX_ATTEMPTS = 3;

export function createRaidRecoveryRuntime(deps: RaidRecoveryDeps) {
  const snapshots = createRaidSnapshotRepository(deps.RaidSnapshotModel);
  const now = deps.now ?? Date.now;

  async function refreshBaseline(guild: RecoveryGuildPort): Promise<boolean> {
    const baseline = await snapshots.readBaseline(guild.id).catch(() => null);
    if (!needsRefresh(baseline, now())) return false;
    const snapshot = await guild.captureSnapshot().catch(() => null);
    if (!snapshot) return false;
    return snapshots.writeBaseline(guild.id, { ...snapshot, capturedAt: new Date(now()) }).catch(() => false);
  }

  async function freezeBaseline(guildId: string): Promise<boolean> {
    return snapshots.freezeBaseline(guildId, new Date(now())).catch(() => false);
  }

  async function releaseBaseline(guildId: string): Promise<boolean> {
    return snapshots.thawBaseline(guildId).catch(() => false);
  }

  async function captureBeforeContainment(
    guild: RecoveryGuildPort,
    incidentId: string,
    incidentStartedAt: Date = new Date(now())
  ): Promise<CaptureOutcome> {
    const existing = await snapshots.read(incidentId).catch(() => null);
    if (existing) return { kind: "already-captured" };

    try {
      const baseline = await snapshots.readBaseline(guild.id).catch(() => null);
      const choice = chooseIncidentSnapshot(baseline, incidentStartedAt, now());
      if (choice.kind === "live-capture") {
        deps.logger?.("WARN", "RAID_RECOVERY", "Recovery porneste de la starea curenta, nu de la un baseline curat", {
          guildId: guild.id,
          incidentId,
          motiv: choice.reason
        });
      }

      const snapshot = choice.kind === "frozen-baseline" ? choice.snapshot : await guild.captureSnapshot();
      const stored = await snapshots.capture(incidentId, guild.id, { ...snapshot, capturedAt: snapshot.capturedAt });
      if (!stored) return { kind: "already-captured" };
      return {
        kind: "captured",
        source: choice.kind,
        note: describeBaselineChoice(choice),
        channels: snapshot.channels.length,
        roles: snapshot.roles.length,
        webhooks: snapshot.webhooks.length,
        invites: snapshot.invites.length
      };
    } catch (error: unknown) {
      deps.logger?.("ERROR", "RAID_RECOVERY", "Snapshotul serverului nu a putut fi capturat", {
        guildId: guild.id,
        incidentId,
        error: error instanceof Error ? error.message : String(error)
      });
      return { kind: "capture-failed", error };
    }
  }

  async function applyOperation(
    guild: RecoveryGuildPort,
    snapshot: RaidSnapshot,
    operation: RecoveryOperation,
    remaps: RoleRemap[],
    recreated: Array<{ previousId: string; nextId: string }>
  ): Promise<{ status: RecoveryOperation["status"]; detail: string | null }> {
    if (operation.kind === "recreate-role") {
      const role = snapshot.roles.find(entry => entry.roleId === operation.resourceId);
      if (!role) return { status: "skipped", detail: "rolul nu mai este in snapshot" };
      const created = await guild.recreateRole(role);
      if (created) {
        remaps.push({ previousRoleId: role.roleId, nextRoleId: created });
        recreated.push({ previousId: role.roleId, nextId: created });
      }
      return created
        ? { status: "done", detail: `recreat cu ID nou ${created}` }
        : { status: "owner-intervention-required", detail: "rolul nu a putut fi recreat" };
    }

    if (operation.kind === "recreate-channel") {
      const stored = snapshot.channels.find(entry => entry.channelId === operation.resourceId);
      if (!stored) return { status: "skipped", detail: "canalul nu mai este in snapshot" };
      const channel = { ...stored, overwrites: remapOverwrites(stored.overwrites, remaps) };
      const created = await guild.recreateChannel(channel);
      if (created) recreated.push({ previousId: channel.channelId, nextId: created });
      return created
        ? { status: "done", detail: `recreat cu ID nou ${created}` }
        : { status: "owner-intervention-required", detail: "canalul nu a putut fi recreat" };
    }

    if (operation.kind === "recreate-webhook") {
      const webhook = snapshot.webhooks.find(entry => entry.webhookId === operation.resourceId);
      if (!webhook) return { status: "skipped", detail: "webhook-ul nu mai este in snapshot" };
      const channelId = remapChannelId(webhook.channelId, recreated);
      if (!channelId) return { status: "skipped", detail: "webhook-ul nu mai are canal in snapshot" };
      const created = await guild.recreateWebhook({ ...webhook, channelId });
      const moved = channelId !== webhook.channelId ? ` in canalul recreat ${channelId}` : "";
      return created
        ? {
          status: "done",
          detail: `recreat ca ${created}${moved}; URL-ul nou se ia din Server Settings > Integrations, `
            + "fiindca e o credentiala si nu se salveaza in incident"
        }
        : { status: "owner-intervention-required", detail: "webhook-ul nu a putut fi recreat" };
    }

    if (operation.kind === "restore-invite") {
      const invite = snapshot.invites.find(entry => entry.code === operation.resourceId);
      if (!invite) return { status: "skipped", detail: "invitatia nu mai este in snapshot" };
      const inviteChannelId = remapChannelId(invite.channelId, recreated);
      if (!inviteChannelId) return { status: "skipped", detail: "invitatia nu mai are canal in snapshot" };
      const created = await guild.restoreInvite({ ...invite, channelId: inviteChannelId });
      const inviteMoved = inviteChannelId !== invite.channelId ? ` in canalul recreat ${inviteChannelId}` : "";
      return created
        ? { status: "done", detail: `invitatie noua ${created}${inviteMoved}; codul vechi nu poate fi reatribuit` }
        : { status: "owner-intervention-required", detail: "invitatia nu a putut fi recreata" };
    }

    const field = operation.resourceId as keyof SnapshotProtections;
    const expected = snapshot.protections[field];
    if (expected === undefined) return { status: "skipped", detail: "protectia nu mai exista" };
    const restored = await guild.restoreProtection(field, expected);
    return restored
      ? { status: "done", detail: `readusa la ${expected ? "pornita" : "oprita"}` }
      : { status: "owner-intervention-required", detail: "protectia nu a putut fi readusa" };
  }

  async function restore(guild: RecoveryGuildPort, incidentId: string): Promise<RecoveryOutcome> {
    const record = await snapshots.read(incidentId).catch(() => null);
    if (!record) return { kind: "no-snapshot" };

    const current = await guild.readCurrentState().catch(() => null);
    if (!current) return { kind: "no-snapshot" };

    const remaps: RoleRemap[] = [];
    const recreated: Array<{ previousId: string; nextId: string }> = [];

    const planned = record.operations.length > 0
      ? record.operations
      : planRecovery(record.snapshot, current);
    if (record.operations.length === 0) await snapshots.savePlan(incidentId, planned).catch(() => false);
    if (planned.length === 0) return { kind: "nothing-to-restore" };

    const live = {
      "recreate-channel": new Set(current.channelIds),
      "recreate-role": new Set(current.roleIds),
      "recreate-webhook": new Set(current.webhookIds),
      "restore-invite": new Set(current.inviteCodes)
    };

    for (const operation of planned) {
      if (operation.status !== "pending") continue;

      const alreadyThere = operation.kind !== "restore-protection" && live[operation.kind].has(operation.resourceId);
      if (alreadyThere) {
        await snapshots.markOperation(incidentId, operation.kind, operation.resourceId, "skipped", "resursa exista deja").catch(() => false);
        continue;
      }
      if (operation.attempts >= MAX_ATTEMPTS) {
        await snapshots
          .markOperation(incidentId, operation.kind, operation.resourceId, "owner-intervention-required", `esuat de ${operation.attempts} ori`)
          .catch(() => false);
        continue;
      }

      const result = await applyOperation(guild, record.snapshot, operation, remaps, recreated).catch(() => ({
        status: "pending" as const,
        detail: "eroare la aplicare"
      }));
      await snapshots.markOperation(incidentId, operation.kind, operation.resourceId, result.status, result.detail).catch(() => false);
    }

    for (const entry of recreated) {
      await deps.onResourceRecreated?.(guild.id, entry.previousId, entry.nextId).catch(() => undefined);
    }

    const after = await snapshots.read(incidentId).catch(() => null);
    const operations = after?.operations ?? planned;
    const complete = recoveryComplete(operations);

    await guild.publish(`Anti-raid ${incidentId}: ${describeRecovery(operations)}`).catch(() => undefined);

    return { kind: "restored", operations, complete };
  }

  return { refreshBaseline, freezeBaseline, releaseBaseline, captureBeforeContainment, restore };
}
