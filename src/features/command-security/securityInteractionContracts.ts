"use strict";

import type { GuildConfigWriteModelLike, LockedChannelPermissionState } from "../guild-config/guildConfigRepository.js";
import type { DirectAttachment } from "../moderation/moderationInputPolicy.js";
import type { NewAccountAlertClaim, NewAccountAlertDeliveryModelLike } from "./newAccountAlertDedup.js";
import type { PermissionRequestModelLike } from "./permissionRequestRepository.js";
import type { ChannelLockRecoveryModelLike } from "./channelLockRecoveryRepository.js";
import type { SecurityStateModel } from "./securityStore.js";
import type { OperationJournalModelLike } from "../../shared/operationJournalEngine.js";

export type AccountAlertClaimFn = (guildId: string, userId: string) => Promise<NewAccountAlertClaim | null>;

export type SecurityOptions = {
  getSubcommand(): string;
  getInteger(name: string, required?: boolean): number | null;
  getString(name: string, required?: boolean): string | null;
  getChannel(name: string, required?: boolean): SecurityChannel | null;
  getAttachment?(name: string, required?: boolean): DirectAttachment | null;
};

export type SecurityChannel = {
  id?: string;
  send?: (payload: unknown) => Promise<unknown>;
  permissionOverwrites?: {
    cache?: { get(targetId: string): { allow?: { has(permission: string): boolean }; deny?: { has(permission: string): boolean } } | undefined };
    edit(target: object, permissions: Record<string, boolean | null>): Promise<unknown>;
  };
  permissionsFor?: (member: object) => { has(flag: bigint): boolean } | null | undefined;
  bulkDelete?: (amount: number, filterOld?: boolean) => Promise<unknown>;
};

export type SecurityMember = {
  user?: { id?: string; tag?: string; bot?: boolean; createdTimestamp?: number } | null;
  joinedTimestamp?: number;
};
export type SecurityMemberCollection = { values(): IterableIterator<SecurityMember> };
export type BotGuildMember = {
  permissions?: { has(flag: bigint): boolean } | null;
  roles?: { highest?: { position?: number } | null } | null;
};
export type SecurityInteraction = {
  commandName?: string;
  guild?: {
    id?: string;
    roles?: { everyone?: { id: string } };
    members?: { me?: (object & BotGuildMember) | null; fetch(): Promise<SecurityMemberCollection> };
    channels?: {
      cache?: { get(channelId: string): SecurityChannel | undefined };
      fetch(channelId: string): Promise<SecurityChannel | null>;
    };
  } | null;
  channel?: SecurityChannel | null;
  options: SecurityOptions;
  user?: { id?: string } | null;
  isChatInputCommand?: () => boolean;
  deferred?: boolean;
  replied?: boolean;
};

export type GuildModelLike = GuildConfigWriteModelLike;

export type GuildSettingsLike = {
  newAccountAlertChannelId?: string | null;
  newAccountAlertsEnabled?: boolean;
  threatAlertChannelId?: string | null;
  threatProtectionEnabled?: boolean;
  botAddAlertChannelId?: string | null;
  botAddProtectionEnabled?: boolean;
  botAddPermissions?: unknown;
  permissionRequestChannelId?: string | null;
  moderationGuardEnabled?: boolean;
  antiRaidAlertChannelId?: string | null;
  antiRaidDryRunEnabled?: boolean;
  purgeAmount?: number;
  lockedChannelIds?: string[];
  lockedChannelPermissions?: Array<{ channelId: string; sendMessages: LockedChannelPermissionState }>;
} | null;

export type SecurityDeps = {
  GuildModel: GuildModelLike;
  getGuildSettings: (guildId: string) => Promise<GuildSettingsLike>;
  safeDefer: (interaction: SecurityInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: SecurityInteraction, payload: unknown) => Promise<unknown>;
  checkChannelPermissions: (interaction: SecurityInteraction, channelId: string) => Promise<{
    viewChannel: boolean;
    sendMessages: boolean;
    embedLinks: boolean;
  } | null>;
  formatUserError: (err: unknown, fallback: string) => string;
  logger?: (level: string, context: string, message: string, meta?: unknown) => void;
  NewAccountAlertDeliveryModel?: NewAccountAlertDeliveryModelLike;
  ChannelLockRecoveryModel?: Pick<ChannelLockRecoveryModelLike, "updateOne">;
  GuildSecurityModel?: SecurityStateModel;
  PermissionRequestModel?: PermissionRequestModelLike;
  OperationJournalModel?: OperationJournalModelLike;
};

export type ProtectionChannelField = "newAccountAlertChannelId" | "threatAlertChannelId" | "botAddAlertChannelId" | "permissionRequestChannelId"
  | "antiRaidAlertChannelId";
export type ProtectionEnabledField = "newAccountAlertsEnabled" | "threatProtectionEnabled" | "botAddProtectionEnabled" | "moderationGuardEnabled"
  | "antiRaidDryRunEnabled";

export type OverwriteEditor = (target: object, permissions: Record<string, boolean | null>) => Promise<unknown>;
export type SecurityLogger = NonNullable<SecurityDeps["logger"]>;
