"use strict";

import { MessageFlags, PermissionsBitField } from "discord.js";

const ADMIN_REQUIRED_MESSAGE = "Access denied.";

type AdminGuardPayload = {
  content: string;
  flags: number;
};

type PermissionSetLike = {
  has: (permission: unknown) => boolean;
};

type RoleCacheLike = {
  has: (roleId: string) => boolean;
  get?: (roleId: string) => RoleLike | undefined;
};

type RoleLike = {
  id?: string;
  position?: number;
};

type MemberRolesLike = RoleCacheLike | { cache?: RoleCacheLike | null; highest?: RoleLike | null } | readonly string[];

type MemberLike = {
  roles?: MemberRolesLike | null;
};

type GuildLike = {
  roles?: { cache?: RoleCacheLike | null } | null;
};

type AdminGuardInteraction = {
  memberPermissions?: PermissionSetLike | null;
  member?: MemberLike | null;
  guild?: GuildLike | null;
  user?: { id?: string } | null;
  deferred?: boolean;
  replied?: boolean;
  reply?: (payload: AdminGuardPayload) => Promise<unknown>;
  followUp?: (payload: AdminGuardPayload) => Promise<unknown>;
};

type AdminRoleAccessMode = "role" | "role-or-higher";

type AdminCommandAccessConfig = {
  mode?: AdminRoleAccessMode | null;
  roleId?: string | null;
};

function parseIdList(value: string | undefined): string[] {
  return String(value || "").split(",").map(id => id.trim()).filter(Boolean);
}

function isGuildAdmin(interaction: Pick<AdminGuardInteraction, "memberPermissions">): boolean {
  return interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) === true;
}

function roleCache(roles: MemberRolesLike | null | undefined): RoleCacheLike | null {
  if (!roles) return null;
  if (Array.isArray(roles)) return null;
  if ("has" in roles && typeof roles.has === "function") return roles;
  if ("cache" in roles) return roles.cache || null;
  return null;
}

function roleHas(roles: MemberRolesLike | null | undefined, roleId: string): boolean {
  if (!roles) return false;
  if (Array.isArray(roles)) return roles.includes(roleId);
  const cache = roleCache(roles);
  return typeof cache?.has === "function" ? cache.has(roleId) : false;
}

function rolePosition(cache: RoleCacheLike | null | undefined, roleId: string): number | null {
  if (typeof cache?.get !== "function") return null;
  const position = cache.get(roleId)?.position;
  return typeof position === "number" ? position : null;
}

function highestMemberRolePosition(roles: MemberRolesLike | null | undefined): number | null {
  if (!roles || !("highest" in roles)) return null;
  const position = roles.highest?.position;
  return typeof position === "number" ? position : null;
}

function hasAllowedAdminRole(interaction: Pick<AdminGuardInteraction, "member">): boolean {
  return false;
}

function hasConfiguredAdminRole(
  interaction: Pick<AdminGuardInteraction, "guild" | "member">,
  config: AdminCommandAccessConfig | null | undefined
): boolean {
  const roleId = config?.roleId || "";
  if (!roleId || !config?.mode) return false;
  const memberRoles = interaction.member?.roles;
  if (roleHas(memberRoles, roleId)) return true;
  if (config.mode !== "role-or-higher") return false;
  const requiredPosition = rolePosition(interaction.guild?.roles?.cache, roleId);
  const memberPosition = highestMemberRolePosition(memberRoles);
  return requiredPosition !== null && memberPosition !== null && memberPosition >= requiredPosition;
}

async function rejectNonAdmin(interaction: AdminGuardInteraction): Promise<void> {
  const payload = {
    content: ADMIN_REQUIRED_MESSAGE,
    flags: MessageFlags.Ephemeral
  };

  if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
    await interaction.followUp(payload);
    return;
  }

  if (typeof interaction.reply === "function") {
    await interaction.reply(payload);
  }
}

async function requireGuildAdmin(interaction: AdminGuardInteraction): Promise<boolean> {
  if (isGuildAdmin(interaction)) return true;
  await rejectNonAdmin(interaction);
  return false;
}

const adminPermissionGuard = Object.assign(requireGuildAdmin, {
  ADMIN_REQUIRED_MESSAGE,
  isGuildAdmin,
  hasAllowedAdminRole,
  hasConfiguredAdminRole,
  roleHas,
  parseIdList,
  rejectNonAdmin
});

export default adminPermissionGuard;
