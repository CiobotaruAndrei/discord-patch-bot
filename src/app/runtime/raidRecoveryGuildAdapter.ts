"use strict";

import { emptyProtections, RAID_SNAPSHOT_VERSION, webhookAvatarUrl } from "../../features/command-security/raidSnapshotTypes.js";

import type { RecoveryGuildPort } from "../../features/command-security/raidRecoveryRuntime.js";
import type {
  CurrentServerState,
  RaidSnapshot,
  SnapshotChannel,
  SnapshotInvite,
  SnapshotProtections,
  SnapshotRole,
  SnapshotWebhook
} from "../../features/command-security/raidSnapshotTypes.js";

export interface AdaptableRecoveryGuild {
  id?: unknown;
  roles?: { cache?: { values?: () => Iterable<unknown> }; create?: (options: Record<string, unknown>) => Promise<{ id?: unknown } | null> };
  channels?: {
    cache?: { values?: () => Iterable<unknown>; get?: (id: string) => unknown };
    create?: (options: Record<string, unknown>) => Promise<{ id?: unknown } | null>;
    fetch?: (id: string) => Promise<unknown>;
  };
  fetchWebhooks?: () => Promise<Iterable<unknown> | { values?: () => Iterable<unknown> } | null>;
  invites?: { fetch?: () => Promise<Iterable<unknown> | { values?: () => Iterable<unknown> } | null> };
}

const RECOVERY_REASON = "Recovery anti-raid: resursa distrusa in incident este recreata din snapshot";

interface RecoverableChannel {
  createWebhook?: (options: Record<string, unknown>) => Promise<{ id?: unknown; url?: unknown } | null>;
  createInvite?: (options: Record<string, unknown>) => Promise<{ code?: unknown } | null>;
}

export type ProtectionSettings = { [Field in keyof SnapshotProtections]?: boolean };
type ProtectionReader = (guildId: string) => Promise<ProtectionSettings | null>;
type ProtectionWriter = (guildId: string, field: string, enabled: boolean) => Promise<boolean>;

const PROTECTION_FIELDS: ReadonlyArray<keyof SnapshotProtections> = [
  "moderationGuardEnabled",
  "antiRaidEnabled",
  "antiRaidDryRunEnabled",
  "threatProtectionEnabled",
  "adProtectionEnabled",
  "newAccountAlertsEnabled"
];

function textOf(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function iterate(source: unknown): unknown[] {
  if (!source) return [];
  if (typeof (source as { values?: () => Iterable<unknown> }).values === "function") {
    return [...(source as { values: () => Iterable<unknown> }).values()];
  }
  const items = [...(source as Iterable<unknown>)];
  return items.map(item => (Array.isArray(item) && item.length === 2 ? item[1] : item));
}

function readChannels(guild: AdaptableRecoveryGuild): SnapshotChannel[] {
  const snapshot: SnapshotChannel[] = [];
  for (const item of iterate(guild.channels?.cache)) {
    const channel = item as {
      id?: unknown; name?: unknown; type?: unknown; parentId?: unknown; rawPosition?: unknown; position?: unknown;
      topic?: unknown; nsfw?: unknown; rateLimitPerUser?: unknown;
      permissionOverwrites?: { cache?: { values?: () => Iterable<unknown> } };
    };
    const channelId = textOf(channel.id);
    if (!channelId) continue;
    snapshot.push({
      channelId,
      name: typeof channel.name === "string" ? channel.name : channelId,
      channelType: numberOf(channel.type) ?? 0,
      parentId: textOf(channel.parentId),
      position: numberOf(channel.rawPosition) ?? numberOf(channel.position),
      topic: textOf(channel.topic),
      nsfw: typeof channel.nsfw === "boolean" ? channel.nsfw : null,
      rateLimitPerUser: numberOf(channel.rateLimitPerUser),
      overwrites: iterate(channel.permissionOverwrites?.cache).flatMap(entry => {
        const overwrite = entry as { id?: unknown; type?: unknown; allow?: { bitfield?: unknown }; deny?: { bitfield?: unknown } };
        const id = textOf(overwrite.id);
        if (!id) return [];
        return [{
          id,
          type: numberOf(overwrite.type) ?? 0,
          allow: String(overwrite.allow?.bitfield ?? "0"),
          deny: String(overwrite.deny?.bitfield ?? "0")
        }];
      })
    });
  }
  return snapshot;
}

function readRoles(guild: AdaptableRecoveryGuild): SnapshotRole[] {
  const snapshot: SnapshotRole[] = [];
  for (const item of iterate(guild.roles?.cache)) {
    const role = item as {
      id?: unknown; name?: unknown; permissions?: { bitfield?: unknown }; position?: unknown;
      color?: unknown; hoist?: unknown; mentionable?: unknown; managed?: unknown;
    };
    const roleId = textOf(role.id);
    if (!roleId) continue;
    snapshot.push({
      roleId,
      name: typeof role.name === "string" ? role.name : roleId,
      permissions: String(role.permissions?.bitfield ?? "0"),
      position: numberOf(role.position) ?? 0,
      color: numberOf(role.color),
      hoist: role.hoist === true,
      mentionable: role.mentionable === true,
      managed: role.managed === true
    });
  }
  return snapshot;
}

function readProtections(settings: ProtectionSettings | null): SnapshotProtections {
  const protections = emptyProtections();
  for (const field of PROTECTION_FIELDS) protections[field] = settings?.[field] === true;
  return protections;
}

export function adaptRecoveryGuild(
  guild: AdaptableRecoveryGuild,
  readGuildSettings: ProtectionReader,
  writeProtection: ProtectionWriter,
  publish: (body: string) => Promise<unknown>
): RecoveryGuildPort | null {
  async function textChannel(channelId: string | null): Promise<RecoverableChannel | null> {
    if (!channelId) return null;
    const cached = guild.channels?.cache?.get?.(channelId);
    if (cached) return cached as RecoverableChannel;
    const fetched = await guild.channels?.fetch?.(channelId).catch(() => null);
    return (fetched as RecoverableChannel | null) ?? null;
  }

  const id = textOf(guild.id);
  if (!id) return null;

  async function readWebhooks(): Promise<SnapshotWebhook[]> {
    if (!guild.fetchWebhooks) return [];
    const payload = await guild.fetchWebhooks().catch(() => null);
    return iterate(payload).flatMap(item => {
      const hook = item as { id?: unknown; channelId?: unknown; name?: unknown; avatar?: unknown };
      const webhookId = textOf(hook.id);
      if (!webhookId) return [];
      return [{
        webhookId,
        channelId: textOf(hook.channelId) ?? "",
        name: typeof hook.name === "string" ? hook.name : webhookId,
        avatar: textOf(hook.avatar)
      }];
    });
  }

  async function readInvites(): Promise<SnapshotInvite[]> {
    if (!guild.invites?.fetch) return [];
    const payload = await guild.invites.fetch().catch(() => null);
    return iterate(payload).flatMap(item => {
      const invite = item as { code?: unknown; channelId?: unknown; inviterId?: unknown; maxAge?: unknown; maxUses?: unknown; temporary?: unknown };
      const code = textOf(invite.code);
      if (!code) return [];
      return [{
        code,
        channelId: textOf(invite.channelId),
        inviterId: textOf(invite.inviterId),
        maxAge: numberOf(invite.maxAge),
        maxUses: numberOf(invite.maxUses),
        temporary: invite.temporary === true
      }];
    });
  }

  return {
    id,

    async captureSnapshot(): Promise<RaidSnapshot> {
      const settings = await readGuildSettings(id).catch(() => null);
      return {
        version: RAID_SNAPSHOT_VERSION,
        capturedAt: new Date(),
        channels: readChannels(guild),
        roles: readRoles(guild),
        webhooks: await readWebhooks(),
        invites: await readInvites(),
        protections: readProtections(settings)
      };
    },

    async readCurrentState(): Promise<CurrentServerState> {
      const settings = await readGuildSettings(id).catch(() => null);
      return {
        channelIds: readChannels(guild).map(channel => channel.channelId),
        roleIds: readRoles(guild).map(role => role.roleId),
        webhookIds: (await readWebhooks()).map(webhook => webhook.webhookId),
        inviteCodes: (await readInvites()).map(invite => invite.code),
        protections: readProtections(settings)
      };
    },

    async recreateChannel(channel) {
      if (!guild.channels?.create) return null;
      const payload: Record<string, unknown> = {
        name: channel.name,
        type: channel.channelType,
        permissionOverwrites: channel.overwrites.map(overwrite => ({
          id: overwrite.id,
          type: overwrite.type,
          allow: BigInt(overwrite.allow),
          deny: BigInt(overwrite.deny)
        }))
      };
      if (channel.parentId !== null) payload.parent = channel.parentId;
      if (channel.position !== null) payload.position = channel.position;
      if (channel.topic !== null) payload.topic = channel.topic;
      if (channel.nsfw !== null) payload.nsfw = channel.nsfw;
      if (channel.rateLimitPerUser !== null) payload.rateLimitPerUser = channel.rateLimitPerUser;
      const created = await guild.channels.create(payload).catch(() => null);
      return textOf(created?.id);
    },

    async recreateRole(role) {
      if (!guild.roles?.create) return null;
      const created = await guild.roles.create({
        name: role.name,
        permissions: BigInt(role.permissions),
        color: role.color ?? undefined,
        hoist: role.hoist,
        mentionable: role.mentionable,
        position: role.position,
        reason: RECOVERY_REASON
      }).catch(() => null);
      return textOf(created?.id);
    },

    async recreateWebhook(webhook) {
      const channel = await textChannel(webhook.channelId);
      if (!channel?.createWebhook) return null;
      const avatar = webhookAvatarUrl(webhook.webhookId, webhook.avatar);
      const created = await channel
        .createWebhook({ name: webhook.name || "webhook", avatar: avatar ?? undefined, reason: RECOVERY_REASON })
        .catch(async () => avatar
          ? channel.createWebhook?.({ name: webhook.name || "webhook", reason: RECOVERY_REASON }).catch(() => null) ?? null
          : null);
      return textOf(created?.id);
    },

    async restoreInvite(invite) {
      if (!invite.channelId) return null;
      const channel = await textChannel(invite.channelId);
      if (!channel?.createInvite) return null;
      const created = await channel
        .createInvite({
          maxAge: invite.maxAge ?? 0,
          maxUses: invite.maxUses ?? 0,
          temporary: invite.temporary,
          unique: true,
          reason: RECOVERY_REASON
        })
        .catch(() => null);
      return textOf(created?.code);
    },

    async restoreProtection(field, enabled) {
      return writeProtection(id, String(field), enabled);
    },

    async publish(body) {
      return publish(body);
    }
  };
}
