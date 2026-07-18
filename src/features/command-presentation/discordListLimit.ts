"use strict";

import type { DiscordReplyPayload } from "../../types.js";

export interface ClampListOptions {
  separator?: string;
  overflowLabel?: (hidden: number) => string;
}

export interface TextPaginationOptions {
  maxChars?: number;
  separator?: string;
  firstPagePrefix?: string;
}

export interface PaginatedTextInteraction {
  followUp?(payload: unknown): Promise<unknown>;
}

export interface SendPaginatedTextOptions<TInteraction extends PaginatedTextInteraction> {
  interaction: TInteraction;
  pages: readonly string[];
  safeEdit: (interaction: TInteraction, payload: DiscordReplyPayload) => Promise<unknown>;
  ephemeral?: boolean;
  ephemeralFlag?: number;
  firstPayload?: DiscordReplyPayload;
  followUpPayload?: (content: string, page: number) => DiscordReplyPayload;
  onFollowUpError?: (error: unknown, page: number) => void;
}

export function clampJoinedList(items: string[], maxChars: number, options: ClampListOptions = {}): string {
  const separator = options.separator ?? "\n";
  const overflowLabel = options.overflowLabel
    ?? ((hidden: number) => `... si inca ${hidden} (lista scurtata ca sa incapa in limita Discord)`);
  const joined = items.join(separator);
  if (joined.length <= maxChars) return joined;

  const noteReserve = separator.length + overflowLabel(items.length).length;
  const budget = Math.max(0, maxChars - noteReserve);
  const kept: string[] = [];
  let used = 0;
  for (const item of items) {
    const additional = (kept.length ? separator.length : 0) + item.length;
    if (used + additional > budget) break;
    kept.push(item);
    used += additional;
  }
  if (!kept.length) {
    return items.length ? items[0].slice(0, maxChars) : "";
  }
  const hidden = items.length - kept.length;
  return `${kept.join(separator)}${separator}${overflowLabel(hidden)}`;
}

export function paginateTextLines(lines: readonly string[], options: TextPaginationOptions = {}): string[] {
  const maxChars = Math.max(1, Math.floor(options.maxChars ?? 1900));
  const separator = options.separator ?? "\n";
  const prefix = options.firstPagePrefix ?? "";
  const pages: string[] = [];
  let current = prefix;
  for (const rawLine of lines) {
    let line = String(rawLine);
    while (line.length > maxChars) {
      if (current) pages.push(current);
      pages.push(line.slice(0, maxChars));
      current = "";
      line = line.slice(maxChars);
    }
    const additional = current ? separator.length + line.length : line.length;
    if (current && current.length + additional > maxChars) {
      pages.push(current);
      current = line;
    } else current += current ? `${separator}${line}` : line;
  }
  if (current || pages.length === 0) pages.push(current);
  return pages;
}

export async function sendPaginatedText<TInteraction extends PaginatedTextInteraction>(options: SendPaginatedTextOptions<TInteraction>): Promise<unknown> {
  const pages = options.pages.length ? options.pages : [""];
  const first = await options.safeEdit(options.interaction, options.firstPayload ?? pages[0]);
  for (let index = 1; index < pages.length; index++) {
    if (!options.interaction.followUp) break;
    const payload = options.followUpPayload?.(pages[index], index) ?? (options.ephemeral
      ? { content: pages[index], flags: options.ephemeralFlag }
      : { content: pages[index] });
    try { await options.interaction.followUp(payload); }
    catch (error: unknown) { options.onFollowUpError?.(error, index); }
  }
  return first;
}
