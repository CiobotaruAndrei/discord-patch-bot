"use strict";

const { MessageFlags, PermissionsBitField } = require("discord.js");

const ADMIN_REQUIRED_MESSAGE = "Eroare: Ai nevoie de Administrator pentru aceasta comanda.";

type AdminGuardPayload = {
  content: string;
  flags: number;
};

type PermissionSetLike = {
  has: (permission: unknown) => boolean;
};

type AdminGuardInteraction = {
  memberPermissions?: PermissionSetLike | null;
  deferred?: boolean;
  replied?: boolean;
  reply?: (payload: AdminGuardPayload) => Promise<unknown>;
  followUp?: (payload: AdminGuardPayload) => Promise<unknown>;
};

function isGuildAdmin(interaction: Pick<AdminGuardInteraction, "memberPermissions">): boolean {
  return interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) === true;
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

Object.assign(requireGuildAdmin, {
  ADMIN_REQUIRED_MESSAGE,
  isGuildAdmin,
  rejectNonAdmin
});

export = requireGuildAdmin;
