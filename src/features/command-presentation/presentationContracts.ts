"use strict";

import type { InteractionMessage } from "../../types.js";

export type PresentationLogger = (level: string, context: string, message: string, meta?: unknown) => void;
export type CommandLogEnd = (status?: string, endExtra?: Record<string, unknown>) => void;

export interface ChainableEmbed {
  setColor(value: unknown): this;
  setTitle(value: unknown): this;
  setFooter(value: unknown): this;
  setURL(value: unknown): this;
  setDescription(value: unknown): this;
  setImage(value: unknown): this;
  setThumbnail(value: unknown): this;
  setTimestamp(value: unknown): this;
  setAuthor(value: unknown): this;
  addFields(...fields: unknown[]): this;
}

export interface ButtonComponent {
  setCustomId(value: string): this;
  setLabel(value: string): this;
  setStyle(value: unknown): this;
  setDisabled(value: boolean): this;
}

export interface ActionRowComponent {
  addComponents(...components: unknown[]): this;
}

export interface DeferEditInteraction {
  user?: { id?: unknown } | null;
  deferred?: boolean;
  replied?: boolean;
  deferReply?(payload?: unknown): Promise<unknown>;
  editReply?(payload: unknown): Promise<InteractionMessage>;
  reply?(payload: unknown): Promise<unknown>;
  followUp?(payload: unknown): Promise<unknown>;
}

export interface LoggableInteraction {
  user?: { id?: unknown } | null;
  guild?: { id?: unknown } | null;
  channel?: { id?: unknown } | null;
}
