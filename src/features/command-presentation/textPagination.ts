"use strict";

function segmentOversizedLine(line: string, maxLength: number): string[] {
  if (line.length <= maxLength) return [line];
  const segments: string[] = [];
  for (let offset = 0; offset < line.length; offset += maxLength) {
    segments.push(line.slice(offset, offset + maxLength));
  }
  return segments;
}

import type { DiscordReplyPayload } from "../../types.js";

export function paginateTextLines(lines: readonly string[], maxLength = 1900): string[] {
  const pages: string[] = [];
  let current = "";
  for (const rawLine of lines) {
    for (const line of segmentOversizedLine(rawLine, maxLength)) {
      const candidate = current ? `${current}\n${line}` : line;
      if (candidate.length <= maxLength) {
        current = candidate;
        continue;
      }
      if (current) pages.push(current);
      current = line;
    }
  }
  if (current) pages.push(current);
  return pages;
}

export async function sendTextPages(
  interaction: {
    reply(payload: DiscordReplyPayload): Promise<unknown>;
    followUp?(payload: DiscordReplyPayload): Promise<unknown>;
  },
  lines: readonly string[],
  emptyMessage: string,
  ephemeral = true
): Promise<unknown> {
  const pages = paginateTextLines(lines.length ? lines : [emptyMessage]);
  const first = await interaction.reply({ content: pages[0], ephemeral });
  for (const page of pages.slice(1)) {
    if (interaction.followUp) await interaction.followUp({ content: page, ephemeral });
  }
  return first;
}

export async function sendPaginatedEdit(
  interaction: { followUp?(payload: DiscordReplyPayload): Promise<unknown> },
  safeEdit: (payload: { content: string; allowedMentions?: unknown }) => Promise<unknown>,
  lines: readonly string[],
  options: { ephemeral?: boolean; emptyMessage?: string; allowedMentions?: unknown } = {}
): Promise<unknown> {
  const ephemeral = options.ephemeral ?? true;
  const mentions = options.allowedMentions;
  const pages = paginateTextLines(lines.length ? lines : [options.emptyMessage ?? "Lista este goala."]);
  const first = await safeEdit(mentions !== undefined ? { content: pages[0], allowedMentions: mentions } : { content: pages[0] });
  for (const page of pages.slice(1)) {
    if (interaction.followUp) {
      await interaction.followUp(mentions !== undefined ? { content: page, ephemeral, allowedMentions: mentions } : { content: page, ephemeral });
    }
  }
  return first;
}

export async function sendPaginatedEditFlags(
  interaction: { followUp?: (payload: { content: string; flags?: number }) => Promise<unknown> },
  safeEdit: (payload: { content: string }) => Promise<unknown>,
  ephemeralFlag: number,
  lines: readonly string[],
  emptyMessage = "Lista este goala."
): Promise<unknown> {
  const pages = paginateTextLines(lines.length ? lines : [emptyMessage]);
  const first = await safeEdit({ content: pages[0] });
  for (const page of pages.slice(1)) {
    if (interaction.followUp) await interaction.followUp({ content: page, flags: ephemeralFlag });
  }
  return first;
}

export default { paginateTextLines, sendTextPages, sendPaginatedEdit, sendPaginatedEditFlags };
