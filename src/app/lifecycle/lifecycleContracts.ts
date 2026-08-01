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
  mentions?: {
    users?: { size?: number };
    roles?: { size?: number };
    everyone?: boolean;
  } | null;
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

export interface SecurityGatewayRuntime {
  handleGuildMemberAdd(member: LifecycleDiscordGuildMember): Promise<void>;
  handleMessageCreate(message: LifecycleDiscordMessage): Promise<void>;
  handleChannelDelete(channel: LifecycleDiscordDeletedChannel): Promise<void>;
}

export interface PermissionDelegationGatewayRuntime {
  handleRoleUpdate(previous: LifecycleDiscordRole, next: LifecycleDiscordRole): Promise<void>;
  handleGuildMemberUpdate(previous: LifecycleDiscordGuildMember, next: LifecycleDiscordGuildMember): Promise<void>;
  handleRoleCreate(role: LifecycleDiscordRole): Promise<void>;
  handleChannelUpdate(previous: LifecycleDiscordDeletedChannel, next: LifecycleDiscordDeletedChannel): Promise<void>;
  handleWebhookUpdate(channel: LifecycleDiscordDeletedChannel): Promise<void>;
}

export interface ModerationLifecycleGatewayRuntime {
  cleanupExpired(): Promise<void>;
  handleGuildMemberRemove(member: LifecycleDiscordGuildMember): Promise<void>;
}

export interface ServerEventLogGatewayRuntime {
  handleGuildMemberAdd(member: LifecycleDiscordGuildMember): Promise<void>;
  handleChannelCreate(channel: LifecycleDiscordDeletedChannel): Promise<void>;
  handleChannelDelete(channel: LifecycleDiscordDeletedChannel): Promise<void>;
  handleRoleCreate(role: LifecycleDiscordRole): Promise<void>;
  handleRoleDelete(role: LifecycleDiscordRole): Promise<void>;
  handleGuildBanAdd(ban: LifecycleDiscordGuildMember): Promise<void>;
  handleGuildBanRemove(ban: LifecycleDiscordGuildMember): Promise<void>;
  handleGuildMemberRemove(member: LifecycleDiscordGuildMember): Promise<void>;
  handleGuildMemberTimeout(previous: LifecycleDiscordGuildMember, next: LifecycleDiscordGuildMember): Promise<void>;
}
