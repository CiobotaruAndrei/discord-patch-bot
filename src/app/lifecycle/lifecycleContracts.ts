"use strict";

export interface LifecycleDiscordInteraction {
  isRepliable?(): boolean;
  isChatInputCommand?(): boolean;
  isAutocomplete?(): boolean;
  commandName?: string;
  deferred?: boolean;
  replied?: boolean;
  reply?(payload: unknown): Promise<unknown>;
  followUp?(payload: unknown): Promise<unknown>;
}

export interface LifecycleDiscordChannel {
  id?: string;
  send?(payload: unknown): Promise<unknown>;
  isTextBased?(): boolean;
  permissionsFor?(member: unknown): unknown;
}

export interface LifecycleDiscordGuild {
  id?: string;
  name?: string;
  systemChannel?: LifecycleDiscordChannel | null;
  channels?: { cache?: { find(predicate: (channel: LifecycleDiscordChannel) => boolean): LifecycleDiscordChannel | undefined } };
  client?: { user?: { id?: string } | null };
}

export interface LifecycleDiscordGuildMember {
  id?: string;
  guild?: { id?: string } | null;
  joinedTimestamp?: number;
  user?: { id?: string; tag?: string; bot?: boolean; createdTimestamp?: number } | null;
}

export interface LifecycleDiscordRole {
  id: string;
  guild: { id: string };
}

export interface LifecycleDiscordDeletedChannel {
  id?: string;
  guild?: { id?: string } | null;
}

export interface LifecycleDiscordMessage {
  guild?: { id?: string } | null;
  author?: { id?: string; tag?: string; bot?: boolean } | null;
  channel?: { id?: string } | null;
  content?: string;
}

export interface LifecycleEventClient {
  user?: { id?: string; tag?: string } | null;
  once(event: "ready", listener: () => unknown): unknown;
  on(event: "interactionCreate", listener: (interaction: LifecycleDiscordInteraction) => unknown): unknown;
  on(event: "guildCreate", listener: (guild: LifecycleDiscordGuild) => unknown): unknown;
  on(event: "guildMemberAdd", listener: (member: LifecycleDiscordGuildMember) => unknown): unknown;
  on(event: "messageCreate", listener: (message: LifecycleDiscordMessage) => unknown): unknown;
  on(event: "roleUpdate", listener: (previous: LifecycleDiscordRole, next?: LifecycleDiscordRole) => unknown): unknown;
  on(event: "roleCreate", listener: (role: LifecycleDiscordRole) => unknown): unknown;
  on(event: "roleDelete", listener: (role: LifecycleDiscordRole) => unknown): unknown;
  on(event: "guildMemberUpdate", listener: (previous: LifecycleDiscordGuildMember, next?: LifecycleDiscordGuildMember) => unknown): unknown;
  on(event: "guildMemberRemove", listener: (member: LifecycleDiscordGuildMember) => unknown): unknown;
  on(event: "guildBanAdd", listener: (ban: LifecycleDiscordGuildMember) => unknown): unknown;
  on(event: "guildBanRemove", listener: (ban: LifecycleDiscordGuildMember) => unknown): unknown;
  on(event: "channelCreate", listener: (channel: LifecycleDiscordDeletedChannel) => unknown): unknown;
  on(event: "channelDelete", listener: (channel: LifecycleDiscordDeletedChannel) => unknown): unknown;
  on(event: "channelUpdate", listener: (previous: LifecycleDiscordDeletedChannel, next?: LifecycleDiscordDeletedChannel) => unknown): unknown;
  on(event: "webhookUpdate", listener: (channel: LifecycleDiscordDeletedChannel) => unknown): unknown;
  on(event: "error" | "shardError", listener: (err: unknown) => unknown): unknown;
  on(event: "warn", listener: (message: string) => unknown): unknown;
}
