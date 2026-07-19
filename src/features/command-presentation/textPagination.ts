"use strict";

export function paginateTextLines(lines: readonly string[], maxLength = 1900): string[] {
  const pages: string[] = [];
  let current = "";
  for (const rawLine of lines) {
    const line = rawLine.length > maxLength ? rawLine.slice(0, maxLength) : rawLine;
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }
    if (current) pages.push(current);
    current = line;
  }
  if (current) pages.push(current);
  return pages;
}

export async function sendTextPages(
  interaction: {
    reply(payload: unknown): Promise<unknown>;
    followUp?: (payload: unknown) => Promise<unknown>;
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
  interaction: { followUp?: (payload: unknown) => Promise<unknown> },
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

export default { paginateTextLines, sendTextPages, sendPaginatedEdit };
