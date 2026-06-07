export const DISCORD_MAX_EMBEDS_PER_MESSAGE = 10;
export const DISCORD_MAX_MESSAGE_EMBED_CHARS = 6000;
export const DEFAULT_EMBED_CHAR_BUDGET = 5800;

interface EmbedJsonLike {
  title?: unknown;
  description?: unknown;
  footer?: { text?: unknown } | null;
  author?: { name?: unknown } | null;
  fields?: Array<{ name?: unknown; value?: unknown }> | null;
}

function strLen(value: unknown): number {
  return typeof value === "string" ? value.length : 0;
}

function readEmbedJson(embed: unknown): EmbedJsonLike {
  if (!embed || typeof embed !== "object") return {};
  const builder = embed as { toJSON?: () => unknown; data?: unknown };
  if (typeof builder.toJSON === "function") {
    try {
      const json = builder.toJSON();
      if (json && typeof json === "object") return json as EmbedJsonLike;
    } catch { void 0; }
  }
  if (builder.data && typeof builder.data === "object") return builder.data as EmbedJsonLike;
  return embed as EmbedJsonLike;
}

export function embedCharCost(embed: unknown): number {
  const json = readEmbedJson(embed);
  let total = strLen(json.title) + strLen(json.description) + strLen(json.footer?.text) + strLen(json.author?.name);
  if (Array.isArray(json.fields)) {
    for (const field of json.fields) total += strLen(field?.name) + strLen(field?.value);
  }
  return total;
}

export function packEmbedsByBudget<T>(
  items: T[],
  sizeOf: (item: T) => number,
  opts: { maxCount?: number; maxChars?: number } = {}
): T[][] {
  const maxCount = Math.max(1, opts.maxCount ?? DISCORD_MAX_EMBEDS_PER_MESSAGE);
  const maxChars = Math.max(1, opts.maxChars ?? DEFAULT_EMBED_CHAR_BUDGET);
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentChars = 0;
  for (const item of items) {
    const size = Math.max(0, sizeOf(item));
    if (current.length > 0 && (current.length >= maxCount || currentChars + size > maxChars)) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(item);
    currentChars += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
