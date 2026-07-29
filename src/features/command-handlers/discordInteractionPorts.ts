"use strict";

import type { DiscordReplyPayload } from "../../types.js";

export interface InteractionGuildRef {
  id: string;
}

export interface PartialInteractionGuildRef {
  id?: string;
}

export interface InteractionUserRef {
  id: string;
}

export interface PartialInteractionUserRef {
  id?: string;
}

export interface BaseChatInputInteraction<Guild = InteractionGuildRef, Payload = DiscordReplyPayload> {
  id?: string;
  commandName?: string;
  guild?: Guild | null;
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand?(): boolean;
  reply?(payload: Payload): Promise<unknown>;
  followUp?(payload: Payload): Promise<unknown>;
}

export type ChatInputInteraction<Options, Guild = InteractionGuildRef, Payload = DiscordReplyPayload> =
  BaseChatInputInteraction<Guild, Payload> & { options: Options };

export interface AlwaysReplies<Payload = DiscordReplyPayload> {
  reply(payload: Payload): Promise<unknown>;
}

export interface AlwaysFollowsUp<Payload = DiscordReplyPayload> {
  followUp(payload: Payload): Promise<unknown>;
}

export interface SubcommandOption {
  getSubcommand(required?: boolean): string;
}

export interface OptionalSubcommandOption {
  getSubcommand(required: false): string | null;
}

export interface SubcommandGroupOption {
  getSubcommandGroup(required?: boolean): string | null;
}

export interface OptionalSubcommandGroupOption {
  getSubcommandGroup?(required?: boolean): string | null;
}

export interface StringOption {
  getString(name: string, required?: boolean): string | null;
}

export interface IntegerOption {
  getInteger(name: string, required?: boolean): number | null;
}

export interface NumberOption {
  getNumber(name: string, required?: boolean): number | null;
}

export interface BooleanOption {
  getBoolean(name: string, required?: boolean): boolean | null;
}

export interface RoleOption<Role> {
  getRole(name: string, required?: boolean): Role | null;
}

export interface UserOption<User> {
  getUser(name: string, required?: boolean): User | null;
}

export interface ChannelOption<Channel> {
  getChannel(name: string, required?: boolean): Channel | null;
}

export interface OptionalChannelOption<Channel> {
  getChannel?(name: string, required?: boolean): Channel | null;
}

export interface AttachmentOption<Attachment> {
  getAttachment?(name: string, required?: boolean): Attachment | null;
}

export interface FocusedOptionReader<Focused> {
  getFocused(detailed: true): Focused | null;
}

export interface AutocompleteResponder<Choice> {
  respond(choices: Choice[]): Promise<unknown>;
}
