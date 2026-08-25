"use strict";

export const RAID_SNAPSHOT_VERSION = 1;

export interface RoleRemap {
  previousRoleId: string;
  nextRoleId: string;
}

export function remapOverwrites(
  overwrites: readonly SnapshotOverwrite[],
  remaps: readonly RoleRemap[]
): SnapshotOverwrite[] {
  if (remaps.length === 0) return [...overwrites];
  const byPrevious = new Map(remaps.map(entry => [entry.previousRoleId, entry.nextRoleId]));
  return overwrites.map(overwrite => {
    const next = byPrevious.get(overwrite.id);
    return next ? { ...overwrite, id: next } : overwrite;
  });
}

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
  | "restore-channel"
  | "restore-role"
  | "remove-extra-channel"
  | "remove-extra-role"
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
  channels?: readonly SnapshotChannel[];
  roles?: readonly SnapshotRole[];
}

export const CHANNEL_DIFF_FIELDS = ["name", "parentId", "position", "topic", "nsfw", "rateLimitPerUser"] as const;
export const ROLE_DIFF_FIELDS = ["name", "permissions", "position", "color", "hoist", "mentionable"] as const;

function sameOverwrites(left: readonly SnapshotOverwrite[], right: readonly SnapshotOverwrite[]): boolean {
  if (left.length !== right.length) return false;
  const byId = new Map(right.map(entry => [entry.id, entry]));
  return left.every(entry => {
    const other = byId.get(entry.id);
    return other !== undefined && other.allow === entry.allow && other.deny === entry.deny && other.type === entry.type;
  });
}

export function diffChannel(expected: SnapshotChannel, live: SnapshotChannel): string[] {
  const changed: string[] = CHANNEL_DIFF_FIELDS.filter(field => expected[field] !== live[field]);
  if (!sameOverwrites(expected.overwrites, live.overwrites)) changed.push("permissions");
  return changed;
}

export function diffRole(expected: SnapshotRole, live: SnapshotRole): string[] {
  return ROLE_DIFF_FIELDS.filter(field => expected[field] !== live[field]);
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

export const CATEGORY_CHANNEL_TYPE = 4;

export function isCategory(channel: SnapshotChannel): boolean {
  return channel.channelType === CATEGORY_CHANNEL_TYPE;
}

function byCategoryFirst(left: SnapshotChannel, right: SnapshotChannel): number {
  if (isCategory(left) === isCategory(right)) return (left.position ?? 0) - (right.position ?? 0);
  return isCategory(left) ? -1 : 1;
}

export interface RecoveryScope {
  createdChannelIds?: readonly string[];
  createdRoleIds?: readonly string[];
}

function operation(kind: RecoveryOperationKind, resourceId: string, label: string): RecoveryOperation {
  return { kind, resourceId, label, status: "pending", attempts: 0, detail: null };
}

export function planRecovery(
  snapshot: RaidSnapshot,
  current: CurrentServerState,
  scope: RecoveryScope = {}
): RecoveryOperation[] {
  const operations: RecoveryOperation[] = [];
  const liveChannels = new Set(current.channelIds);
  const liveRoles = new Set(current.roleIds);
  const liveWebhooks = new Set(current.webhookIds);
  const liveInvites = new Set(current.inviteCodes);

  for (const role of snapshot.roles) {
    if (liveRoles.has(role.roleId) || role.managed) continue;
    operations.push({ kind: "recreate-role", resourceId: role.roleId, label: role.name, status: "pending", attempts: 0, detail: null });
  }

  const missingChannels = snapshot.channels.filter(channel => !liveChannels.has(channel.channelId));
  for (const channel of [...missingChannels].sort(byCategoryFirst)) {
    operations.push({ kind: "recreate-channel", resourceId: channel.channelId, label: channel.name, status: "pending", attempts: 0, detail: null });
  }

  for (const webhook of snapshot.webhooks) {
    if (liveWebhooks.has(webhook.webhookId)) continue;
    operations.push({ kind: "recreate-webhook", resourceId: webhook.webhookId, label: webhook.name, status: "pending", attempts: 0, detail: null });
  }

  const liveChannelsById = new Map((current.channels ?? []).map(channel => [channel.channelId, channel]));
  const liveRolesById = new Map((current.roles ?? []).map(role => [role.roleId, role]));

  for (const role of snapshot.roles) {
    const live = liveRolesById.get(role.roleId);
    if (!live || role.managed) continue;
    const changed = diffRole(role, live);
    if (changed.length > 0) operations.push(operation("restore-role", role.roleId, `${role.name} (${changed.join(", ")})`));
  }

  for (const channel of snapshot.channels) {
    const live = liveChannelsById.get(channel.channelId);
    if (!live) continue;
    const changed = diffChannel(channel, live);
    if (changed.length > 0) operations.push(operation("restore-channel", channel.channelId, `${channel.name} (${changed.join(", ")})`));
  }

  const knownChannels = new Set(snapshot.channels.map(channel => channel.channelId));
  for (const channelId of scope.createdChannelIds ?? []) {
    if (knownChannels.has(channelId) || !liveChannels.has(channelId)) continue;
    const live = liveChannelsById.get(channelId);
    operations.push(operation("remove-extra-channel", channelId, live?.name ?? channelId));
  }

  const knownRoles = new Set(snapshot.roles.map(role => role.roleId));
  for (const roleId of scope.createdRoleIds ?? []) {
    if (knownRoles.has(roleId) || !liveRoles.has(roleId)) continue;
    const live = liveRolesById.get(roleId);
    operations.push(operation("remove-extra-role", roleId, live?.name ?? roleId));
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
  return operations.every(operation => operation.status === "done" || operation.status === "skipped");
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

  const webhooks = operations.filter(operation => operation.kind === "recreate-webhook" && operation.status === "done");
  if (webhooks.length > 0) {
    parts.push(
      `${webhooks.length} webhook-uri au fost recreate: ${webhooks.map(operation => operation.label).join(", ")}. `
        + "URL-urile lor sunt noi si se iau din Server Settings > Integrations - sunt credentiale, deci nu se publica aici."
    );
  }

  const invites = operations.filter(operation => operation.kind === "restore-invite" && operation.status === "done");
  if (invites.length > 0) {
    parts.push(`${invites.length} invitatii au fost recreate cu coduri noi; cele vechi nu mai functioneaza.`);
  }

  return parts.join(" ");
}

export interface ResourceRemap {
  previousId: string;
  nextId: string;
}

export function remapChannelId(channelId: string | null, recreated: readonly ResourceRemap[]): string | null {
  if (!channelId) return null;
  const moved = recreated.find(entry => entry.previousId === channelId);
  return moved ? moved.nextId : channelId;
}

export function webhookAvatarUrl(webhookId: string, avatar: string | null): string | null {
  if (!avatar) return null;
  if (avatar.startsWith("http") || avatar.startsWith("data:")) return avatar;
  const extension = avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${webhookId}/${avatar}.${extension}`;
}
