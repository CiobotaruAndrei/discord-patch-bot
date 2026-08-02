"use strict";

export const RAID_SNAPSHOT_VERSION = 1;

export interface SnapshotOverwrite {
  id: string;
  type: number;
  allow: string;
  deny: string;
}

export interface SnapshotChannel {
  channelId: string;
  name: string;
  channelType: number;
  parentId: string | null;
  position: number | null;
  topic: string | null;
  nsfw: boolean | null;
  rateLimitPerUser: number | null;
  overwrites: SnapshotOverwrite[];
}

export interface SnapshotRole {
  roleId: string;
  name: string;
  permissions: string;
  position: number;
  color: number | null;
  hoist: boolean;
  mentionable: boolean;
  managed: boolean;
}

export interface SnapshotWebhook {
  webhookId: string;
  channelId: string;
  name: string;
  avatar: string | null;
}

export interface SnapshotInvite {
  code: string;
  channelId: string | null;
  inviterId: string | null;
  maxAge: number | null;
  maxUses: number | null;
  temporary: boolean;
}

export interface SnapshotProtections {
  moderationGuardEnabled: boolean;
  antiRaidEnabled: boolean;
  antiRaidDryRunEnabled: boolean;
  threatProtectionEnabled: boolean;
  adProtectionEnabled: boolean;
  newAccountAlertsEnabled: boolean;
}

export interface RaidSnapshot {
  version: number;
  capturedAt: Date;
  channels: SnapshotChannel[];
  roles: SnapshotRole[];
  webhooks: SnapshotWebhook[];
  invites: SnapshotInvite[];
  protections: SnapshotProtections;
}

export type RecoveryOperationKind =
  | "recreate-channel"
  | "recreate-role"
  | "recreate-webhook"
  | "restore-invite"
  | "restore-protection";

export type RecoveryStatus = "pending" | "done" | "skipped" | "owner-intervention-required";

export interface RecoveryOperation {
  kind: RecoveryOperationKind;
  resourceId: string;
  label: string;
  status: RecoveryStatus;
  attempts: number;
  detail: string | null;
}

export interface CurrentServerState {
  channelIds: readonly string[];
  roleIds: readonly string[];
  webhookIds: readonly string[];
  inviteCodes: readonly string[];
  protections: SnapshotProtections;
}

export function emptyProtections(): SnapshotProtections {
  return {
    moderationGuardEnabled: false,
    antiRaidEnabled: false,
    antiRaidDryRunEnabled: false,
    threatProtectionEnabled: false,
    adProtectionEnabled: false,
    newAccountAlertsEnabled: false
  };
}

export function emptySnapshot(capturedAt: Date): RaidSnapshot {
  return {
    version: RAID_SNAPSHOT_VERSION,
    capturedAt,
    channels: [],
    roles: [],
    webhooks: [],
    invites: [],
    protections: emptyProtections()
  };
}

export function planRecovery(snapshot: RaidSnapshot, current: CurrentServerState): RecoveryOperation[] {
  const operations: RecoveryOperation[] = [];
  const liveChannels = new Set(current.channelIds);
  const liveRoles = new Set(current.roleIds);
  const liveWebhooks = new Set(current.webhookIds);
  const liveInvites = new Set(current.inviteCodes);

  for (const role of snapshot.roles) {
    if (liveRoles.has(role.roleId) || role.managed) continue;
    operations.push({ kind: "recreate-role", resourceId: role.roleId, label: role.name, status: "pending", attempts: 0, detail: null });
  }

  for (const channel of snapshot.channels) {
    if (liveChannels.has(channel.channelId)) continue;
    operations.push({ kind: "recreate-channel", resourceId: channel.channelId, label: channel.name, status: "pending", attempts: 0, detail: null });
  }

  for (const webhook of snapshot.webhooks) {
    if (liveWebhooks.has(webhook.webhookId)) continue;
    operations.push({ kind: "recreate-webhook", resourceId: webhook.webhookId, label: webhook.name, status: "pending", attempts: 0, detail: null });
  }

  for (const invite of snapshot.invites) {
    if (liveInvites.has(invite.code)) continue;
    operations.push({ kind: "restore-invite", resourceId: invite.code, label: invite.code, status: "pending", attempts: 0, detail: null });
  }

  for (const [key, expected] of Object.entries(snapshot.protections)) {
    const live = current.protections[key as keyof SnapshotProtections];
    if (live === expected) continue;
    operations.push({ kind: "restore-protection", resourceId: key, label: key, status: "pending", attempts: 0, detail: null });
  }

  return operations;
}

export function recoveryComplete(operations: readonly RecoveryOperation[]): boolean {
  return operations.every(operation => operation.status !== "pending");
}

export function describeRecovery(operations: readonly RecoveryOperation[]): string {
  if (operations.length === 0) return "Nu a ramas nimic de recreat: structura serverului este cea din snapshot.";
  const done = operations.filter(operation => operation.status === "done").length;
  const blocked = operations.filter(operation => operation.status === "owner-intervention-required");
  const skipped = operations.filter(operation => operation.status === "skipped").length;

  const parts = [`${done} din ${operations.length} operatiuni de restaurare au reusit.`];
  if (skipped > 0) parts.push(`${skipped} nu mai erau necesare.`);
  if (blocked.length > 0) {
    parts.push(
      `Cer interventia ownerului: ${blocked.map(operation => `${operation.label} (${operation.detail ?? "motiv necunoscut"})`).join(", ")}.`
    );
  }
  parts.push("Resursele recreate au ID-uri noi, deci permisiunile per-membru, mesajele si linkurile vechi nu pot fi recuperate.");
  return parts.join(" ");
}
