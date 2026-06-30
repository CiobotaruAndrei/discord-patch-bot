"use strict";

const { MessageFlags, PermissionsBitField } = require("discord.js");

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
};

type MemberRolesLike = RoleCacheLike | { cache?: RoleCacheLike | null } | readonly string[];

type MemberLike = {
  roles?: MemberRolesLike | null;
};

type AdminGuardInteraction = {
  memberPermissions?: PermissionSetLike | null;
  member?: MemberLike | null;
  deferred?: boolean;
  replied?: boolean;
  reply?: (payload: AdminGuardPayload) => Promise<unknown>;
  followUp?: (payload: AdminGuardPayload) => Promise<unknown>;
};

function parseIdList(value: string | undefined): string[] {
  return String(value || "").split(",").map(id => id.trim()).filter(Boolean);
}

function isGuildAdmin(interaction: Pick<AdminGuardInteraction, "memberPermissions">): boolean {
  return interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) === true;
}

function roleHas(roles: MemberRolesLike | null | undefined, roleId: string): boolean {
  if (!roles) return false;
  if (Array.isArray(roles)) return roles.includes(roleId);
  if (typeof (roles as RoleCacheLike).has === "function") return (roles as RoleCacheLike).has(roleId);
  const cache = (roles as { cache?: RoleCacheLike | null }).cache;
  return typeof cache?.has === "function" ? cache.has(roleId) : false;
}

function hasAllowedAdminRole(interaction: Pick<AdminGuardInteraction, "member">): boolean {
  const allowed = parseIdList(process.env.BOT_ADMIN_ROLE_IDS);
  if (!allowed.length) return false;
  return allowed.some(roleId => roleHas(interaction.member?.roles, roleId));
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
  if (isGuildAdmin(interaction) || hasAllowedAdminRole(interaction)) return true;
  await rejectNonAdmin(interaction);
  return false;
}

Object.assign(requireGuildAdmin, {
  ADMIN_REQUIRED_MESSAGE,
  isGuildAdmin,
  hasAllowedAdminRole,
  parseIdList,
  rejectNonAdmin
});

export = requireGuildAdmin;
