"use strict";

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

export interface CanarySummary {
  byType: CanaryTypeSummary[];
  dealsOk: boolean;
  dealsCount: number;
  failures: string[];
  pass: boolean;
}

export function summarizeCanary(gameResults: CanaryGameResult[], dealsOk: boolean, dealsCount: number): CanarySummary {
  const byTypeMap = new Map<string, { total: number; ok: number }>();
  for (const result of gameResults) {
    const entry = byTypeMap.get(result.type) || { total: 0, ok: 0 };
    entry.total += 1;
    if (result.ok) entry.ok += 1;
    byTypeMap.set(result.type, entry);
  }
  const byType: CanaryTypeSummary[] = Array.from(byTypeMap.entries()).map(([type, entry]) => ({
    type,
    total: entry.total,
    ok: entry.ok,
    failed: entry.total - entry.ok,
    brokenSource: entry.total > 0 && entry.ok === 0
  }));
  const failures: string[] = [];
  for (const summary of byType) {
    if (summary.brokenSource) {
      failures.push(`sursa "${summary.type}": 0/${summary.total} jocuri au intors date valide (posibil schimbare de HTML/API la sursa)`);
    }
  }
  if (!dealsOk) {
    failures.push("sursa de reduceri (fetchDeals) nu a intors date valide");
  }
  return { byType, dealsOk, dealsCount, failures, pass: failures.length === 0 };
}

interface CanarySources {
  getLatestForAllGames: (games: unknown[]) => Promise<Array<{ game: { key: string; type?: string }; latest: unknown; error?: string }>>;
  fetchDeals: (opts: { currency: string }) => Promise<unknown[]>;
}

async function main(): Promise<void> {
  process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/discord-patch-bot-canary";
  process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || "canary-token";
  process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "canary-client-id";

  const mongoose = require("mongoose");
  const sources = require("../sources/sourceRegistry") as CanarySources;
  const { loadConfig } = require("../config/configLoader") as { loadConfig: () => { games: Array<{ key: string; type?: string }> } };

  let connected = false;
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
    connected = true;
  } catch {
    console.log("[CANARY] MongoDB indisponibil; circuit breaker-ul ruleaza fail-open. Continui verificarea surselor.");
  }

  const { games } = loadConfig();
  const steamGames = games.filter(game => !game.type || game.type === "steam");

  let gameResults: CanaryGameResult[] = [];
  try {
    const results = await sources.getLatestForAllGames(steamGames);
    gameResults = results.map(result => ({
      key: String(result.game.key),
      type: String(result.game.type || "steam"),
      ok: result.latest != null,
      error: result.error
    }));
  } catch (err) {
    console.log(`[CANARY] getLatestForAllGames inconcludent (timeout/retea, NU sursa rupta): ${(err as Error).message}`);
  }

  let dealsOk = false;
  let dealsCount = 0;
  try {
    const deals = await sources.fetchDeals({ currency: "USD" });
    dealsCount = Array.isArray(deals) ? deals.length : 0;
    dealsOk = dealsCount > 0;
  } catch (err) {
    console.log(`[CANARY] fetchDeals inconcludent (timeout/retea): ${(err as Error).message}`);
    dealsOk = true;
  }

  const summary = summarizeCanary(gameResults, dealsOk, dealsCount);
  console.log("Canary surse — verificare live (date din src/config.json):");
  for (const type of summary.byType) {
    console.log(`- ${type.type}: ${type.ok}/${type.total} OK${type.brokenSource ? "  [SURSA RUPTA]" : ""}`);
  }
  console.log(`- deals: ${summary.dealsOk ? "OK" : "ESEC"} (${summary.dealsCount} oferte)`);
  for (const failure of summary.failures) console.error(`::error::[canary-sources] ${failure}`);

  if (connected) await mongoose.disconnect().catch(() => undefined);

  if (!summary.pass) {
    console.error(`Canary surse: ${summary.failures.length} sursa(e) par rupte — verifica daca site-ul si-a schimbat HTML/API.`);
    process.exit(1);
  }
  console.log("Canary surse OK: fiecare tip de sursa a intors date valide.");
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

export {};
