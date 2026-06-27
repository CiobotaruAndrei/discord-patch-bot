"use strict";

export interface ClampListOptions {
  separator?: string;
  overflowLabel?: (hidden: number) => string;
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
