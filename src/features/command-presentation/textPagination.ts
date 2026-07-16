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

export default { paginateTextLines, sendTextPages };
