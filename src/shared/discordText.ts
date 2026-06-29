"use strict";

const MARKDOWN_AND_MENTION = /[\\`*_~|>@<:#]/g;

export function escapeInlineText(value: unknown, maxLength = 300): string {
  const collapsed = String(value ?? "").replace(/[\r\n\t]+/g, " ").trim();
  const escaped = collapsed.replace(MARKDOWN_AND_MENTION, char => `\\${char}`);
  return escaped.slice(0, maxLength);
}

export const NO_MENTIONS = { parse: [] as string[] };
