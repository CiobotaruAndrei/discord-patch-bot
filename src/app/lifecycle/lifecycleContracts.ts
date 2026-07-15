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
  guild?: { id?: string } | null;
  joinedTimestamp?: number;
  user?: { id?: string; tag?: string; bot?: boolean; createdTimestamp?: number } | null;
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
  on(event: "error" | "shardError", listener: (err: unknown) => unknown): unknown;
  on(event: "warn", listener: (message: string) => unknown): unknown;
}
