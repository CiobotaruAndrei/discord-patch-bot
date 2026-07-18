"use strict";

import type { CheerioAPI } from "cheerio";
import { dlcPageHasAgeGate, dlcPageLooksLikeStorePage, parseDlcRows } from "./dlcSteamPage.js";

export interface DlcSourceDeps {
  httpReq: (method: string, url: string, options?: Record<string, unknown>) => Promise<{ data: unknown }>;
  safeCheerioLoad: (html: unknown) => CheerioAPI;
  logger?: (level: string, context: string, message: string, meta?: unknown) => void;
}

export interface GameDlc {
  dlcKey: string;
  name: string;
  price: string;
}

export type FetchGameDlcsOutcome =
  | { status: "ok"; dlcs: GameDlc[] }
  | { status: "age-gate" }
  | { status: "parse-error" }
  | { status: "unavailable" };

export function normalizeDlcKey(id: string | null | undefined, name: string): string {
  const trimmed = String(id ?? "").trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  return `name:${name.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

export async function fetchGameDlcs(deps: DlcSourceDeps, appId: string | number, currencyCode = "us"): Promise<FetchGameDlcsOutcome> {
  const url = `https://store.steampowered.com/app/${appId}?cc=${currencyCode}&l=english`;
  let html: unknown;
  try {
    const response = await deps.httpReq("GET", url, {
      headers: { Cookie: "birthtime=283993201; mature_content=1;" },
      timeout: 15000
    });
    html = response.data;
  } catch (err) {
    deps.logger?.("WARN", "DLC_SOURCE", `Nu am putut prelua pagina DLC pentru ${appId}`, err);
    return { status: "unavailable" };
  }
  const $ = deps.safeCheerioLoad(html);
  if (dlcPageHasAgeGate($)) return { status: "age-gate" };
  const rows = parseDlcRows($);
  if (!rows.length) return dlcPageLooksLikeStorePage($) ? { status: "ok", dlcs: [] } : { status: "parse-error" };
  return {
    status: "ok",
    dlcs: rows.map(row => ({ dlcKey: normalizeDlcKey(row.id, row.name), name: row.name, price: row.price }))
  };
}

export default { fetchGameDlcs, normalizeDlcKey };
