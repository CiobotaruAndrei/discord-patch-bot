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

import type { SourceRegistryApi } from "../../sources/sourceRegistry";

type MongoContextExports = typeof import("../../infra/mongo/mongoContext");

const data = require("../../infra/mongo/mongoContext") as MongoContextExports;
const scrapers = require("../../sources/sourceRegistry") as SourceRegistryApi;
const redis = require("../../infra/redis/redisContext") as typeof import("../../infra/redis/redisContext");

type DiscordRuntimeBindings = {
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
    id?: unknown;
    members?: { me?: unknown };
    channels?: {
      cache?: { get(channelId: string): unknown };
      fetch?(channelId: string): Promise<unknown>;
    };
  } | null;
};

interface ChannelPermissions {
  viewChannel: boolean;
  sendMessages: boolean;
  embedLinks: boolean;
  readMessageHistory: boolean;
}

async function resolvePermissionsFor(interaction: PermissionAwareInteraction, channelId: string): Promise<{ has(flag: unknown): boolean } | null> {
  try {
    const guild = interaction?.guild;
    const me = guild?.members?.me;
    if (!me || !guild?.channels) return null;
    const cached = guild.channels.cache?.get(channelId);
    const channel = (cached ?? (typeof guild.channels.fetch === "function"
      ? await guild.channels.fetch(channelId).catch(() => null)
      : null)) as PermissionAwareChannel | null;
    if (!channel || typeof channel.permissionsFor !== "function") return null;
    return channel.permissionsFor(me);
  } catch {
    return null;
  }
}

async function checkReadMessageHistory(interaction: PermissionAwareInteraction, channelId: string): Promise<boolean | null> {
  const perms = await resolvePermissionsFor(interaction, channelId);
  return perms ? perms.has(PermissionsBitField.Flags.ReadMessageHistory) : null;
}

async function checkChannelPermissions(interaction: PermissionAwareInteraction, channelId: string): Promise<ChannelPermissions | null> {
  const perms = await resolvePermissionsFor(interaction, channelId);
  if (!perms) return null;
  return {
    viewChannel: perms.has(PermissionsBitField.Flags.ViewChannel),
    sendMessages: perms.has(PermissionsBitField.Flags.SendMessages),
    embedLinks: perms.has(PermissionsBitField.Flags.EmbedLinks),
    readMessageHistory: perms.has(PermissionsBitField.Flags.ReadMessageHistory)
  };
}

type CommandRuntimeContext = DiscordRuntimeBindings & MongoContextExports & SourceRegistryApi & {
  checkReadMessageHistory: typeof checkReadMessageHistory;
  checkChannelPermissions: typeof checkChannelPermissions;
  redis: typeof redis;
};

function createCommandRuntimeContext(): CommandRuntimeContext {
  return {
    ...createDiscordRuntimeBindings(),
    ...data,
    ...scrapers,
    checkReadMessageHistory,
    checkChannelPermissions,
    redis
  };
}

export = Object.assign(createCommandRuntimeContext, {
  createCommandRuntimeContext,
  createDiscordRuntimeBindings,
  checkChannelPermissions,
  checkReadMessageHistory
});
