"use strict";

import type { DealInfo, GuildSettings } from "../../types.js";
import type { SteamAppDetailsSummary } from "../../sources/sourceApis.js";

import { errorMessage } from "../../shared/errors.js";

export const PLAYER_COUNT_SNAPSHOT_FRESH_MS = 15 * 60_000;

type Logger = (level: string, context: string, message: string, meta?: Record<string, string | number | boolean | null>) => void;
type SteamSearchCandidate = { id?: string | number; name?: string };

export interface PlayerCountSnapshot {
  playerCount: number;
  fetchedAt: Date;
}

export interface GameInfoLookupDeps {
  logger: Logger;
  searchSteamGameByName(query: string, currency: string): Promise<SteamSearchCandidate[]>;
  chooseBestSteamMatch(items: SteamSearchCandidate[], query: string, options?: { forceGameOnly?: boolean }): SteamSearchCandidate | null;
  fetchSteamPriceDetails(appId: string | number, currency: string): Promise<SteamAppDetailsSummary | null>;
  readPlayerCountSnapshots?(appIds: readonly (string | number)[]): Promise<Map<string, { appId: string; gameKey: string; playerCount: number; fetchedAt: Date }>>;
  getDealsCacheData(currency: string): DealInfo[] | null;
  setDealsCache(currency: string, deals: DealInfo[]): void;
  fetchDeals(opts: { currency: string }): Promise<DealInfo[]>;
  getGuildSettings(guildId: string): Promise<GuildSettings | null>;
  DEFAULT_CURRENCY: string;
}

export function createGameInfoLookupService(deps: GameInfoLookupDeps) {
  const {
    searchSteamGameByName, chooseBestSteamMatch, fetchSteamPriceDetails,
    getDealsCacheData, setDealsCache, fetchDeals, getGuildSettings, DEFAULT_CURRENCY
  } = deps;

  async function resolveCurrency(explicit: string | null, guildId: string | null): Promise<string> {
    if (explicit) return explicit;
    const guild = guildId ? await getGuildSettings(guildId) : null;
    return String(guild?.currency || DEFAULT_CURRENCY);
  }

  async function loadDeals(currency: string): Promise<DealInfo[]> {
    const cached = getDealsCacheData(currency);
    if (cached) return cached;
    const deals = await fetchDeals({ currency });
    setDealsCache(currency, deals);
    return deals;
  }

  async function resolveSteam(query: string, currency: string): Promise<{ appId: string | number; details: SteamAppDetailsSummary } | null> {
    const items = await searchSteamGameByName(query, currency);
    const best = chooseBestSteamMatch(items, query, { forceGameOnly: true });
    if (!best?.id) return null;
    const details = await fetchSteamPriceDetails(best.id, currency);
    return details ? { appId: best.id, details } : null;
  }

  async function readFreshSnapshots(appIds: readonly string[]): Promise<Map<string, PlayerCountSnapshot>> {
    if (typeof deps.readPlayerCountSnapshots !== "function") return new Map();
    try {
      const snapshots = await deps.readPlayerCountSnapshots(appIds);
      const fresh = new Map<string, PlayerCountSnapshot>();
      const now = Date.now();
      for (const [appId, snapshot] of snapshots) {
        if (now - snapshot.fetchedAt.getTime() <= PLAYER_COUNT_SNAPSHOT_FRESH_MS) {
          fresh.set(appId, { playerCount: snapshot.playerCount, fetchedAt: snapshot.fetchedAt });
        }
      }
      return fresh;
    } catch (err) {
      deps.logger("WARN", "GAME_INFO", "Citirea snapshot-urilor de player-count a esuat, revin la fetch live", { error: errorMessage(err) });
      return new Map();
    }
  }

  return { resolveCurrency, loadDeals, resolveSteam, readFreshSnapshots };
}
