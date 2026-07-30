import { pathToFileURL as __pathToFileURL } from "node:url";
"use strict";

import type { SourceRegistryApi } from "../sources/sourceRegistry.js";
import type { ConfigLoadResult, GameConfig } from "../config/configTypes.js";
import type { FetchResult } from "../sources/sourceTypes.js";

export interface CanaryGameResult {
  key: string;
  type: string;
  ok: boolean;
  error?: string;
}

export interface CanaryTypeSummary {
  type: string;
  total: number;
  ok: number;
  failed: number;
  brokenSource: boolean;
}

export interface CanaryCrashes {
  gamesCrashed?: string;
  dealsCrashed?: string;
}

export interface CanarySummary {
  byType: CanaryTypeSummary[];
  dealsOk: boolean;
  dealsCount: number;
  failures: string[];
  pass: boolean;
}

export const RELIABLE_CANARY_TYPES: ReadonlySet<string> = new Set(["steam", "minecraft", "roblox"]);

export function filterCanaryGames<G extends { type?: string }>(games: G[]): G[] {
  return (games || []).filter(game => !game.type || RELIABLE_CANARY_TYPES.has(String(game.type)));
}

export function filterFragileCanaryGames<G extends { type?: string }>(games: G[]): G[] {
  return (games || []).filter(game => game.type && !RELIABLE_CANARY_TYPES.has(String(game.type)));
}

export interface DealsStoreBreakdown {
  byStore: Record<string, number>;
  epicMissing: boolean;
}

export function summarizeDealsByStore(deals: Array<{ store?: unknown }>): DealsStoreBreakdown {
  const byStore: Record<string, number> = {};
  for (const deal of deals || []) {
    const store = String((deal && deal.store) || "necunoscut");
    byStore[store] = (byStore[store] || 0) + 1;
  }
  return { byStore, epicMissing: !byStore["Epic Games"] };
}

export function summarizeByType(gameResults: CanaryGameResult[]): CanaryTypeSummary[] {
  const byTypeMap = new Map<string, { total: number; ok: number }>();
  for (const result of gameResults) {
    const entry = byTypeMap.get(result.type) || { total: 0, ok: 0 };
    entry.total += 1;
    if (result.ok) entry.ok += 1;
    byTypeMap.set(result.type, entry);
  }
  return Array.from(byTypeMap.entries()).map(([type, entry]) => ({
    type,
    total: entry.total,
    ok: entry.ok,
    failed: entry.total - entry.ok,
    brokenSource: entry.total > 0 && entry.ok === 0
  }));
}

export function summarizeCanary(
  gameResults: CanaryGameResult[],
  dealsOk: boolean,
  dealsCount: number,
  crashes: CanaryCrashes = {}
): CanarySummary {
  const byType = summarizeByType(gameResults);
  const failures: string[] = [];
  if (crashes.gamesCrashed) {
    failures.push(`getLatestForAllGames a crapat complet (fail-closed): ${crashes.gamesCrashed} — pentru rulari controlate cu retea instabila seteaza explicit ALLOW_CANARY_NETWORK_SKIP=true`);
  }
  for (const summary of byType) {
    if (summary.brokenSource) {
      failures.push(`sursa "${summary.type}": 0/${summary.total} jocuri au intors date valide (posibil schimbare de HTML/API la sursa)`);
    }
  }
  if (crashes.dealsCrashed) {
    failures.push(`fetchDeals a crapat complet (fail-closed): ${crashes.dealsCrashed} — pentru rulari controlate cu retea instabila seteaza explicit ALLOW_CANARY_NETWORK_SKIP=true`);
  } else if (!dealsOk) {
    failures.push("sursa de reduceri (fetchDeals) nu a intors date valide");
  }
  return { byType, dealsOk, dealsCount, failures, pass: failures.length === 0 };
}

export function buildFragileWarnings(gameResults: CanaryGameResult[]): string[] {
  const warnings: string[] = [];
  for (const summary of summarizeByType(gameResults)) {
    if (summary.brokenSource) {
      warnings.push(`sursa fragila "${summary.type}": 0/${summary.total} jocuri au intors date valide (scraping HTML/proxy — warning-only, verifica manual cu PROXY_URLS setat daca persista)`);
    }
  }
  return warnings;
}

type CanarySources = Pick<SourceRegistryApi, "getLatestForAllGames" | "fetchDeals">;

async function main(): Promise<void> {
  process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/discord-patch-bot-canary";
  process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || "canary-token";
  process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "canary-client-id";
  const allowNetworkSkip = process.env.ALLOW_CANARY_NETWORK_SKIP === "true";

  const mongoose = await import("mongoose");
  const sources: CanarySources = (await import("../app/runtimeComposition.js")).sourceRegistry;
  const { loadConfig } = await import("../config/configLoader.js");

  let connected = false;
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
    connected = true;
  } catch {
    console.log("[CANARY] MongoDB indisponibil; circuit breaker-ul ruleaza fail-open. Continui verificarea surselor.");
  }

  const { games } = loadConfig();
  const canaryGames = filterCanaryGames(games);

  const crashes: CanaryCrashes = {};
  let gameResults: CanaryGameResult[] = [];
  try {
    const results = await sources.getLatestForAllGames(canaryGames);
    gameResults = results.map(result => ({
      key: String(result.game.key),
      type: String(result.game.type || "steam"),
      ok: result.latest != null,
      error: result.error || undefined
    }));
  } catch (err) {
    if (allowNetworkSkip) {
      console.log(`[CANARY] getLatestForAllGames sarit explicit (ALLOW_CANARY_NETWORK_SKIP=true): ${(err as Error).message}`);
    } else {
      crashes.gamesCrashed = (err as Error).message;
    }
  }

  let dealsOk = false;
  let dealsCount = 0;
  let storeBreakdown: DealsStoreBreakdown | null = null;
  try {
    const deals = await sources.fetchDeals({ currency: "USD" });
    dealsCount = Array.isArray(deals) ? deals.length : 0;
    dealsOk = dealsCount > 0;
    if (Array.isArray(deals)) storeBreakdown = summarizeDealsByStore(deals);
  } catch (err) {
    if (allowNetworkSkip) {
      console.log(`[CANARY] fetchDeals sarit explicit (ALLOW_CANARY_NETWORK_SKIP=true): ${(err as Error).message}`);
      dealsOk = true;
    } else {
      crashes.dealsCrashed = (err as Error).message;
      dealsOk = false;
    }
  }

  const summary = summarizeCanary(gameResults, dealsOk, dealsCount, crashes);
  console.log("Canary surse — verificare live (date din src/config.json):");
  for (const type of summary.byType) {
    console.log(`- ${type.type}: ${type.ok}/${type.total} OK${type.brokenSource ? "  [SURSA RUPTA]" : ""}`);
  }
  console.log(`- deals: ${summary.dealsOk ? "OK" : "ESEC"} (${summary.dealsCount} oferte)`);
  if (storeBreakdown) {
    const parts = Object.entries(storeBreakdown.byStore).map(([store, count]) => `${store}: ${count}`).join(", ");
    console.log(`- deals pe store: ${parts || "(niciun store)"}`);
    if (dealsOk && storeBreakdown.epicMissing) {
      console.warn("::warning::[canary-sources] 0 oferte Epic Games in fetchDeals — endpoint-ul Epic e posibil rupt sau blocheaza IP-ul de runner; totalul e acoperit de Steam, deci canarul nu pica, dar verifica manual integrarea Epic.");
    }
  }
  for (const failure of summary.failures) console.error(`::error::[canary-sources] ${failure}`);

  const fragileGames = filterFragileCanaryGames(games);
  if (fragileGames.length > 0) {
    let fragileResults: CanaryGameResult[] = [];
    try {
      const results = await sources.getLatestForAllGames(fragileGames);
      fragileResults = results.map(result => ({
        key: String(result.game.key),
        type: String(result.game.type || "steam"),
        ok: result.latest != null,
        error: result.error || undefined
      }));
    } catch (err) {
      console.warn(`::warning::[canary-sources] verificarea surselor fragile a crapat complet (warning-only): ${(err as Error).message}`);
    }
    if (fragileResults.length > 0) {
      console.log("Canary surse fragile (warning-only, nu afecteaza exit code):");
      for (const type of summarizeByType(fragileResults)) {
        console.log(`- [fragil] ${type.type}: ${type.ok}/${type.total} OK${type.brokenSource ? "  [POSIBIL RUPTA]" : ""}`);
      }
      for (const warning of buildFragileWarnings(fragileResults)) {
        console.warn(`::warning::[canary-sources] ${warning}`);
      }
    }
  }

  if (connected) await mongoose.disconnect().catch(() => undefined);

  if (!summary.pass) {
    console.error(`Canary surse: ${summary.failures.length} problema(e) blocante — verifica daca sursa si-a schimbat HTML/API sau daca fetch-ul a crapat complet.`);
    process.exit(1);
  }
  console.log("Canary surse OK: fiecare tip de sursa a intors date valide.");
}

if (process.argv[1] !== undefined && __pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(err => { console.error(err); process.exit(1); });
}

export {};
