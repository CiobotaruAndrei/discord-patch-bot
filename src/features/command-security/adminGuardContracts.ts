"use strict";

import type { GuildAuditLogModelLike } from "../admin-records/auditLogRepository.js";
import type { AdminCommandAccessByCommand, AdminCommandAccessConfig } from "./adminCommandAccessScope.js";

export type MaybePromise<T> = T | Promise<T>;
export type AdminGuardGameConfig = { key: string; name: string } & Record<string, unknown>;
export type AdminGuardPayload = { content: string; flags: number };

export type ModalSubmitLike = {
  user?: { id?: string } | null;
  customId?: string;
  deferred?: boolean;
  replied?: boolean;
  fields?: { getTextInputValue?: (customId: string) => string };
  reply?: (payload: AdminGuardPayload) => Promise<unknown>;
  followUp?: (payload: AdminGuardPayload) => Promise<unknown>;
  deferReply?: (payload?: unknown) => Promise<unknown>;
  editReply?: (payload: unknown) => Promise<unknown>;
};

export type GuildOwnerMember = {
  id?: string;
  user?: { id?: string } | null;
};

export type RoleLike = { id?: string; position?: number };
export type RoleCacheLike = {
  has: (roleId: string) => boolean;
  get?: (roleId: string) => RoleLike | undefined;
};
export type MemberRolesLike = RoleCacheLike | { cache?: RoleCacheLike | null; highest?: RoleLike | null };

export type AdminGuardInteraction = {
  commandName?: string;
  guild?: {
    id?: string;
    ownerId?: string | null;
    fetchOwner?: () => Promise<GuildOwnerMember | null>;
    roles?: { cache?: RoleCacheLike | null } | null;
  } | null;
  member?: { roles?: MemberRolesLike | null } | null;
  memberPermissions?: { has: (permission: unknown) => boolean } | null;
  user?: { id?: string } | null;
  globalAccessCodeAuthorized?: boolean;
  isChatInputCommand?: () => boolean;
  deferred?: boolean;
  replied?: boolean;
  reply?: (payload: AdminGuardPayload) => Promise<unknown>;
  followUp?: (payload: AdminGuardPayload) => Promise<unknown>;
  deferReply?: (payload?: unknown) => Promise<unknown>;
  editReply?: (payload: unknown) => Promise<unknown>;
  showModal?: (modal: unknown) => Promise<unknown>;
  awaitModalSubmit?: (options: { filter: (interaction: ModalSubmitLike) => boolean; time: number }) => Promise<ModalSubmitLike>;
  options?: {
    getSubcommand?: (required?: boolean) => string;
    getSubcommandGroup?: (required?: boolean) => string | null;
  };
};

export type NextInteractionHandler = (interaction: AdminGuardInteraction, games: AdminGuardGameConfig[]) => MaybePromise<unknown>;
export type RequireGuildAdmin = (interaction: AdminGuardInteraction) => Promise<boolean>;

export type GuildAdminAccessDoc = {
  adminCommandAccess?: AdminCommandAccessConfig | null;
  adminCommandAccessByCommand?: AdminCommandAccessByCommand | null;
};
export type GuildAdminAccessQuery = { lean: () => Promise<GuildAdminAccessDoc | null> };
export type GuildAdminAccessModel = {
  updateOne?: (filter: object, update: object, options?: object) => Promise<unknown>;
  findOne?: (filter: { _id: string }) => GuildAdminAccessQuery | Promise<GuildAdminAccessDoc | null>;
  db?: { readyState?: number };
};
export type GuildModelLike = GuildAdminAccessModel;
export type AdminGuardAuditModel = GuildAuditLogModelLike & { db?: { readyState?: number } };

export type AdminCommandGuardDeps = {
  requireGuildAdmin: RequireGuildAdmin;
  authorizeGuildAdmin?: (interaction: AdminGuardInteraction) => Promise<AdminGuardInteraction | null>;
};

export type SecurityEnvSlice = {
  BOT_SENSITIVE_USER_IDS?: readonly string[];
  BOT_GLOBAL_ACCESS_CODE?: string;
  BOT_GLOBAL_ACCESS_CODE_HASH?: string;
};

export type AdminCommandGuardContext = {
  GuildModel?: GuildModelLike;
  GuildAuditLogModel?: AdminGuardAuditModel;
  env?: SecurityEnvSlice;
  adminAlert?: (kind: string, title: string, body: string, guildId?: string) => Promise<unknown>;
};

export type DefaultRequireGuildAdmin = RequireGuildAdmin & {
  isGuildAdmin: (interaction: AdminGuardInteraction) => boolean;
  hasConfiguredAdminRole: (interaction: AdminGuardInteraction, config: AdminCommandAccessConfig | null | undefined) => boolean;
  rejectNonAdmin: (interaction: AdminGuardInteraction) => Promise<void>;
};
