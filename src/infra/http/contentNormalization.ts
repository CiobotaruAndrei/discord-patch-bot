"use strict";

import type { DealInfo, NormalizedUpdate, PatchUpdate } from "../../types";
import {
  cleanText as rustCleanText,
  dealHash as rustDealHash,
  normalizeDealState as rustNormalizeDealState,
  normalizeTitleForDedupe as rustNormalizeTitleForDedupe,
  stableUpdateId as rustStableUpdateId
} from "../../native/fuzzy";

type CheerioModule = typeof import("cheerio");

export interface ContentNormalizationDeps {
  cheerio: CheerioModule;
  maxHtmlBytes: number;
}

export function createContentNormalization({ cheerio, maxHtmlBytes }: ContentNormalizationDeps) {
  function cleanText(text: unknown): string {
    return rustCleanText(text);
  }

  function truncate(str: unknown, maxLen: number): string {
    const t = String(str || "");
    return t.length > maxLen ? t.substring(0, maxLen - 3) + "..." : t;
  }

  function normalizeTitleForDedupe(str: unknown): string {
    return rustNormalizeTitleForDedupe(str);
  }

  function stableUpdateId(title: unknown, link: unknown): string {
    return rustStableUpdateId(title, link);
  }

  function normalizeUpdate(data: PatchUpdate): NormalizedUpdate {
    let id = String(data.id || "");
    if (!id) id = stableUpdateId(data.title, data.link);
    return {
      id,
      title: truncate(data.title || "Update nou", 250),
      link: String(data.link || ""),
      excerpt: truncate(data.excerpt || "", 700),
      fullText: truncate(data.fullText || "", 3500),
      image: data.image || null,
      thumbnail: data.thumbnail || null,
      timestamp: data.timestamp || ""
    } as NormalizedUpdate;
  }

  function safeCheerioLoad(html: unknown) {
    const str = typeof html === "string" ? html : String(html || "");
    if (str.length * 4 <= maxHtmlBytes) return cheerio.load(str);
    const byteLen = Buffer.byteLength(str, "utf8");
    if (byteLen <= maxHtmlBytes) return cheerio.load(str);

    const buf = Buffer.from(str, "utf8");
    let end = Math.min(buf.length, maxHtmlBytes);
    while (end > 0) {
      const nextByte = buf[end];
      if (nextByte === undefined || (nextByte & 0xC0) !== 0x80) break;
      end--;
    }
    return cheerio.load(buf.subarray(0, end).toString("utf8"));
  }

  function normalizeDealState(deal: DealInfo): string {
    return rustNormalizeDealState(deal);
  }

  function dealHash(deal: DealInfo): string {
    return rustDealHash(deal);
  }

  return {
    cleanText,
    truncate,
    normalizeTitleForDedupe,
    stableUpdateId,
    normalizeUpdate,
    safeCheerioLoad,
    normalizeDealState,
    dealHash
  };
}
