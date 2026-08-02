"use strict";

import { createWebhookSnapshotRepository } from "./webhookSnapshotRepository.js";
import { changeActions, describeChanges, diffWebhooks } from "./webhookGuardTypes.js";
import { describeSanction, planRoleSanction, type SanctionRole } from "./protectedResourceSanction.js";

import type { WebhookSnapshotModelLike } from "./webhookSnapshotRepository.js";
import type { WebhookChange, WebhookSnapshotEntry } from "./webhookGuardTypes.js";
import type { LogLevel } from "../../shared/logging.js";

export interface WebhookGuardActor {
  roles: readonly SanctionRole[];
  removeRoles(roleIds: readonly string[], reason: string): Promise<void>;
}

export interface WebhookGuardChannel {
  guildId: string;
  channelId: string;
  channelName: string;
  ownerId: string | null;
  botHighestRolePosition: number | null;
  everyoneRoleId: string;
  listWebhooks(): Promise<WebhookSnapshotEntry[]>;
  findAuditActor(): Promise<string | null>;
  deleteWebhook(webhookId: string, reason: string): Promise<void>;
  editWebhook(webhookId: string, patch: { name: string; avatar: string | null }, reason: string): Promise<void>;
  recreateWebhook(entry: WebhookSnapshotEntry, reason: string): Promise<string | null>;
  resolveActor(actorId: string): Promise<WebhookGuardActor | null>;
}

export interface WebhookGuardGate {
  readSituation(guildId: string): Promise<{ guardEnabled: boolean; raidConfirmed: boolean }>;
  consumeApproval(guildId: string, actorId: string, channelId: string, action: string): Promise<{ _id: string } | null>;
}

export interface WebhookGuardDeps {
  WebhookSnapshotModel: WebhookSnapshotModelLike;
  gate: WebhookGuardGate;
  publish: (guildId: string, message: string) => Promise<void>;
  recordAudit: (guildId: string, entry: { userId: string; action: string; details: string }) => Promise<void>;
  logger?: (level: LogLevel, scope: string, message: string, meta?: Record<string, unknown>) => void;
  now?: () => number;
}

export type WebhookGuardOutcome =
  | { kind: "guard-disabled" }
  | { kind: "raid-active" }
  | { kind: "no-change" }
  | { kind: "baseline-captured" }
  | { kind: "actor-unknown"; changes: readonly WebhookChange[] }
  | { kind: "allowed-owner" }
  | { kind: "allowed-approval"; requestId: string }
  | { kind: "reverted"; changes: readonly WebhookChange[]; corrected: number; failed: number };

const REASON = "Protectie moderation-guard: webhook modificat fara aprobare de tip webhook";

export function createWebhookGuardRuntime(deps: WebhookGuardDeps) {
  const snapshots = createWebhookSnapshotRepository(deps.WebhookSnapshotModel);
  const now = deps.now ?? Date.now;

  async function capture(channel: WebhookGuardChannel, entries: readonly WebhookSnapshotEntry[]): Promise<void> {
    await snapshots.write(channel.guildId, channel.channelId, entries, new Date(now())).catch(error => {
      deps.logger?.("WARN", "WEBHOOK_GUARD", "Snapshotul de webhook-uri nu a putut fi salvat", {
        guildId: channel.guildId,
        channelId: channel.channelId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }

  async function correct(channel: WebhookGuardChannel, change: WebhookChange): Promise<boolean> {
    if (change.kind === "create") {
      await channel.deleteWebhook(change.webhookId, REASON);
      return true;
    }
    if (change.kind === "update" && change.previous) {
      await channel.editWebhook(change.webhookId, { name: change.previous.name, avatar: change.previous.avatar }, REASON);
      return true;
    }
    if (change.kind === "delete" && change.previous) {
      const recreated = await channel.recreateWebhook(change.previous, REASON);
      return recreated !== null;
    }
    return false;
  }

  async function sanction(
    channel: WebhookGuardChannel,
    actorId: string,
    changes: readonly WebhookChange[],
    failed: number
  ): Promise<void> {
    const actor = await channel.resolveActor(actorId).catch(() => null);
    const plan = planRoleSanction({
      actorRoles: actor?.roles ?? [],
      botHighestRolePosition: channel.botHighestRolePosition,
      everyoneRoleId: channel.everyoneRoleId
    });

    if (actor && plan.removable.length > 0) {
      await actor.removeRoles(plan.removable.map(role => role.id), REASON).catch(error => {
        deps.logger?.("WARN", "WEBHOOK_GUARD", "Eliminarea rolurilor autorului a esuat", {
          guildId: channel.guildId,
          actorId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }

    const lines = [
      `<@${actorId}> a modificat webhook-uri fara aprobare.`,
      `Canal: ${channel.channelName || channel.channelId}`,
      `Modificari: ${describeChanges(changes)}`,
      failed === 0
        ? "Toate modificarile au fost corectate din snapshot."
        : `${failed} din ${changes.length} modificari NU au putut fi corectate; verificare manuala necesara.`,
      "Un webhook recreat primeste un URL nou; integrarile care foloseau URL-ul vechi trebuie reconfigurate.",
      describeSanction(plan)
    ];
    await deps.publish(channel.guildId, lines.join("\n")).catch(() => undefined);
  }

  async function handleWebhookUpdate(channel: WebhookGuardChannel): Promise<WebhookGuardOutcome> {
    const record = await snapshots.read(channel.guildId, channel.channelId).catch(() => null);
    const current = await channel.listWebhooks().catch(() => null);
    if (!current) return { kind: "no-change" };

    if (!record) {
      await capture(channel, current);
      return { kind: "baseline-captured" };
    }

    const situation = await deps.gate.readSituation(channel.guildId).catch(() => ({ guardEnabled: false, raidConfirmed: false }));
    if (!situation.guardEnabled) {
      await capture(channel, current);
      return { kind: "guard-disabled" };
    }
    if (situation.raidConfirmed) {
      await capture(channel, current);
      return { kind: "raid-active" };
    }

    const changes = diffWebhooks(record.entries, current);
    if (changes.length === 0) return { kind: "no-change" };

    const actorId = await channel.findAuditActor().catch(() => null);
    if (!actorId) {
      await capture(channel, current);
      return { kind: "actor-unknown", changes };
    }
    if (channel.ownerId && actorId === channel.ownerId) {
      await capture(channel, current);
      return { kind: "allowed-owner" };
    }

    const actions = changeActions(changes);
    const approved = new Set<string>();
    const approvals: string[] = [];
    for (const action of actions) {
      const approval = await deps.gate
        .consumeApproval(channel.guildId, actorId, channel.channelId, action)
        .catch(() => null);
      if (!approval) continue;
      approved.add(action);
      approvals.push(approval._id);
    }
    if (approved.size === actions.length) {
      await capture(channel, current);
      return { kind: "allowed-approval", requestId: approvals.join(",") };
    }

    const unapproved = changes.filter(change => !approved.has(change.kind));
    let failed = 0;
    for (const change of unapproved) {
      const done = await correct(channel, change).catch(() => false);
      if (!done) failed += 1;
    }

    await deps.recordAudit(channel.guildId, {
      userId: actorId,
      action: "webhook-change-reverted",
      details: `channelId=${channel.channelId}; modificari=${describeChanges(unapproved)}; necorectate=${failed}`
    }).catch(() => undefined);

    await sanction(channel, actorId, unapproved, failed);

    const after = await channel.listWebhooks().catch(() => current);
    await capture(channel, after);

    return { kind: "reverted", changes: unapproved, corrected: unapproved.length - failed, failed };
  }

  return { handleWebhookUpdate, clearSnapshots: snapshots.clear };
}

export interface WebhookGuardRuntime<TChannel = never> {
  handleWebhookUpdate: (channel: TChannel) => Promise<void>;
}
