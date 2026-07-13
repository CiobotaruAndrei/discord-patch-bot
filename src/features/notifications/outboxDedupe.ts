"use strict";

import type { OutboxKind } from "./outboxTypes";

import { createHash } from "crypto";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

export function dedupeKeyFor(job: { guildId: string; channelId: string; kind: OutboxKind; payload: unknown }): string {
  const source = `${job.guildId}|${job.channelId}|${job.kind}|${stableStringify(job.payload)}`;
  return createHash("sha256").update(source).digest("hex");
}

export function outboxDedupeMarker(dedupeKey: string): string {
  return `id:${dedupeKey.slice(0, 16)}`;
}

export function applyDedupeMarker(payload: unknown, dedupeKey: string | undefined): unknown {
  if (!dedupeKey || !payload || typeof payload !== "object") return payload;
  const record = payload as Record<string, unknown>;
  const embeds = Array.isArray(record.embeds) ? record.embeds : null;
  if (!embeds || !embeds.length) return payload;
  const marker = outboxDedupeMarker(dedupeKey);
  const last = (embeds[embeds.length - 1] && typeof embeds[embeds.length - 1] === "object")
    ? { ...embeds[embeds.length - 1] as Record<string, unknown> } : {};
  const footer = (last.footer && typeof last.footer === "object")
    ? { ...last.footer as Record<string, unknown> } : {};
  const existing = typeof footer.text === "string" ? footer.text : "";
  if (existing.includes(marker)) return payload;
  footer.text = existing ? `${existing} · ${marker}` : marker;
  last.footer = footer;
  const nextEmbeds = embeds.slice();
  nextEmbeds[nextEmbeds.length - 1] = last;
  return { ...record, embeds: nextEmbeds };
}

export function messageHasDedupeMarker(message: unknown, marker: string): boolean {
  const embeds = (message && typeof message === "object" && Array.isArray((message as { embeds?: unknown[] }).embeds))
    ? (message as { embeds: Array<{ footer?: { text?: unknown } }> }).embeds : [];
  return embeds.some(embed => typeof embed?.footer?.text === "string" && embed.footer.text.includes(marker));
}
