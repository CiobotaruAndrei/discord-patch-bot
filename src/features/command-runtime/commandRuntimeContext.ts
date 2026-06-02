import crypto = require("crypto");
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder
} from "discord.js";

const data = require("../../infra/mongo/mongoContext");
const scrapers = require("../../sources/sourceRegistry");

interface DiscordRuntimeBindings {
  crypto: typeof crypto;
  EmbedBuilder: typeof EmbedBuilder;
  ActionRowBuilder: typeof ActionRowBuilder;
  ButtonBuilder: typeof ButtonBuilder;
  ButtonStyle: typeof ButtonStyle;
  ComponentType: typeof ComponentType;
  MessageFlags: typeof MessageFlags;
  PermissionsBitField: typeof PermissionsBitField;
  SlashCommandBuilder: typeof SlashCommandBuilder;
  Routes: typeof Routes;
  REST: typeof REST;
}

function createDiscordRuntimeBindings(): DiscordRuntimeBindings {
  return {
    crypto,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    MessageFlags,
    PermissionsBitField,
    SlashCommandBuilder,
    Routes,
    REST
  };
}

type PermissionAwareChannel = {
  permissionsFor(member: unknown): { has(flag: unknown): boolean } | null;
};
type PermissionAwareInteraction = {
  guild?: {
    members?: { me?: unknown };
    channels?: {
      cache?: { get(channelId: string): unknown };
      fetch?(channelId: string): Promise<unknown>;
    };
  } | null;
};

async function checkReadMessageHistory(interaction: PermissionAwareInteraction, channelId: string): Promise<boolean | null> {
  try {
    const guild = interaction?.guild;
    const me = guild?.members?.me;
    if (!me || !guild?.channels) return null;
    const cached = guild.channels.cache?.get(channelId);
    const channel = (cached ?? (typeof guild.channels.fetch === "function"
      ? await guild.channels.fetch(channelId).catch(() => null)
      : null)) as PermissionAwareChannel | null;
    if (!channel || typeof channel.permissionsFor !== "function") return null;
    const perms = channel.permissionsFor(me);
    return perms ? perms.has(PermissionsBitField.Flags.ReadMessageHistory) : null;
  } catch {
    return null;
  }
}

function createCommandRuntimeContext(): Record<string, unknown> {
  return {
    ...createDiscordRuntimeBindings(),
    ...data,
    ...scrapers,
    checkReadMessageHistory
  };
}

export = Object.assign(createCommandRuntimeContext, {
  createCommandRuntimeContext,
  createDiscordRuntimeBindings
});
